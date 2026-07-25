// P-124 — API keys admin: list / create / rotate / revoke.
//
// SECURITY MODEL
//   - RLS (P-017) is the DB backstop: only company_admin can INSERT/UPDATE
//     api_keys for their company. We ALSO re-check the role server-side via
//     has_company_role — belt and braces, per the P-124 spec.
//   - Raw secrets are minted server-side with crypto.getRandomValues, hashed
//     with SHA-256 before storage, and returned ONCE in the mutation
//     response. key_hash is NEVER included in listApiKeys output.
//   - key_prefix is the first 10 chars of the raw key ("gm_" + 7 random),
//     enough to visually disambiguate keys without leaking the secret.
//   - Every mutation writes an audit_logs row with prefix-only metadata.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/public-api/scopes";

// ---------- shared types ---------------------------------------------------

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: "active" | "expired" | "revoked";
};

export type CreatedKeyResult = {
  key: ApiKeyRow;
  /** Full raw secret — shown ONCE, never persisted anywhere else. */
  raw: string;
};

// ---------- helpers --------------------------------------------------------

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), { statusCode: status });
}

async function assertCompanyAdmin(ctx: AuthContext): Promise<void> {
  const { data } = await ctx.supabase.rpc("has_company_role", {
    p_role: "company_admin" as never,
  });
  if (data !== true) httpError(403, "forbidden_role");
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) httpError(400, "no_company");
  return cid as string;
}

/** base64url of a byte array (no padding). */
function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint a raw API key: "gm_" + base64url(32 random bytes). */
function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `gm_${base64Url(bytes)}`;
}

/** SHA-256 hex digest (matches Postgres verify_api_key hashing). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function statusOf(row: {
  revoked_at: string | null;
  expires_at: string | null;
}): "active" | "expired" | "revoked" {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

const scopeArraySchema = z
  .array(z.string())
  .min(1, "select at least one scope")
  .max(API_KEY_SCOPES.length)
  .refine(
    (arr) => arr.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s)),
    "unknown scope",
  )
  .transform((arr) => Array.from(new Set(arr)) as ApiKeyScope[]);

// SELECT projection — never includes key_hash.
const SAFE_SELECT =
  "id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at";

async function writeAudit(
  ctx: AuthContext,
  companyId: string,
  action: string,
  keyId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ctx.supabase.from("audit_logs").insert({
    company_id: companyId,
    actor_id: ctx.user!.id,
    action,
    entity: "api_keys",
    entity_id: keyId,
    metadata,
  } as never);
}

// ---------- list -----------------------------------------------------------

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ApiKeyRow[]> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const { data, error } = await context.supabase
      .from("api_keys")
      .select(SAFE_SELECT)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return ((data ?? []) as Array<Omit<ApiKeyRow, "status">>).map((row) => ({
      ...row,
      scopes: (row.scopes ?? []) as ApiKeyScope[],
      status: statusOf(row),
    }));
  });

// ---------- create ---------------------------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1, "name required").max(120),
  scopes: scopeArraySchema,
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof createSchema>) => createSchema.parse(input))
  .handler(async ({ context, data }): Promise<CreatedKeyResult> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const raw = generateRawKey();
    const hash = await sha256Hex(raw);
    const prefix = raw.slice(0, 10);

    const { data: inserted, error } = await context.supabase
      .from("api_keys")
      .insert({
        company_id: companyId,
        name: data.name,
        key_prefix: prefix,
        key_hash: hash,
        scopes: data.scopes,
        expires_at: data.expiresAt,
        created_by: context.user!.id,
      } as never)
      .select(SAFE_SELECT)
      .single();
    if (error) throw error;

    const row = inserted as Omit<ApiKeyRow, "status">;
    await writeAudit(context, companyId, "api_key.created", row.id, {
      name: data.name,
      scopes: data.scopes,
      prefix,
      expires_at: data.expiresAt,
    });

    return {
      key: {
        ...row,
        scopes: (row.scopes ?? []) as ApiKeyScope[],
        status: statusOf(row),
      },
      raw,
    };
  });

// ---------- rotate ---------------------------------------------------------

const rotateSchema = z.object({ keyId: z.string().uuid() });

export const rotateApiKey = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof rotateSchema>) => rotateSchema.parse(input))
  .handler(async ({ context, data }): Promise<CreatedKeyResult> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    // Confirm the key belongs to this company AND isn't already revoked.
    // RLS also enforces this, but the friendly error path is nicer.
    const existing = await context.supabase
      .from("api_keys")
      .select("id, name, revoked_at")
      .eq("id", data.keyId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const row = existing.data as { id: string; name: string; revoked_at: string | null } | null;
    if (!row) httpError(404, "key_not_found");
    if (row!.revoked_at) httpError(409, "key_revoked");

    const raw = generateRawKey();
    const hash = await sha256Hex(raw);
    const prefix = raw.slice(0, 10);

    const { data: updated, error } = await context.supabase
      .from("api_keys")
      .update({
        key_hash: hash,
        key_prefix: prefix,
        last_used_at: null,
      } as never)
      .eq("id", data.keyId)
      .eq("company_id", companyId)
      .select(SAFE_SELECT)
      .single();
    if (error) throw error;

    const out = updated as Omit<ApiKeyRow, "status">;
    await writeAudit(context, companyId, "api_key.rotated", out.id, {
      name: out.name,
      prefix,
    });

    return {
      key: {
        ...out,
        scopes: (out.scopes ?? []) as ApiKeyScope[],
        status: statusOf(out),
      },
      raw,
    };
  });

// ---------- revoke ---------------------------------------------------------

const revokeSchema = z.object({ keyId: z.string().uuid() });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof revokeSchema>) => revokeSchema.parse(input))
  .handler(async ({ context, data }): Promise<ApiKeyRow> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const { data: updated, error } = await context.supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", data.keyId)
      .eq("company_id", companyId)
      .is("revoked_at", null) // idempotent: no-op if already revoked
      .select(SAFE_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "key_not_found_or_already_revoked");

    const row = updated as Omit<ApiKeyRow, "status">;
    await writeAudit(context, companyId, "api_key.revoked", row.id, {
      name: row.name,
      prefix: row.key_prefix,
    });

    return {
      ...row,
      scopes: (row.scopes ?? []) as ApiKeyScope[],
      status: statusOf(row),
    };
  });
