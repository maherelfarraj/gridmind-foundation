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
  /** CIDR/IPv4 allowlist enforced by the public-API guard (empty = any IP). */
  allowed_ips?: string[];
  /** True when an HMAC signing secret is configured. Secret is never returned. */
  has_hmac?: boolean;
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
      .select(`${SAFE_SELECT}, allowed_ips, hmac_secret`)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // hmac_secret is read only to derive a boolean — it is stripped here and
    // never crosses the RPC boundary.
    return ((data ?? []) as Array<Record<string, unknown>>).map((raw) => {
      const { hmac_secret, ...row } = raw as { hmac_secret: string | null } & Omit<
        ApiKeyRow,
        "status" | "has_hmac"
      >;
      return {
        ...row,
        scopes: (row.scopes ?? []) as ApiKeyScope[],
        allowed_ips: (row.allowed_ips ?? []) as string[],
        has_hmac: !!hmac_secret,
        status: statusOf(row),
      };
    });
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

// ---------- security: IP allowlist + HMAC signing secret -------------------
//
// The public-API guard (P-121) reads api_keys.allowed_ips (stage 2) and
// api_keys.hmac_secret (stage 3). Both had no admin surface; this fn is it.
//   - Allowlist entries are IPv4 addresses or CIDR blocks ("*" = any).
//   - The HMAC secret is minted server-side (32 random bytes, base64url) and
//     returned ONCE, exactly like the API key itself.

/** IPv4 address or CIDR block, e.g. 203.0.113.7 or 203.0.113.0/24. */
const ipEntrySchema = z
  .string()
  .trim()
  .refine((v) => {
    if (v === "*") return true;
    const [addr, bitsRaw, ...rest] = v.split("/");
    if (rest.length) return false;
    const parts = addr.split(".");
    if (parts.length !== 4) return false;
    if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
    if (bitsRaw === undefined) return true;
    const bits = Number(bitsRaw);
    return /^\d{1,2}$/.test(bitsRaw) && bits >= 0 && bits <= 32;
  }, "must be an IPv4 address, CIDR block, or *");

const securitySchema = z.object({
  keyId: z.string().uuid(),
  /** Full replacement list. Empty array = allow any IP (guard warns instead). */
  allowedIps: z.array(ipEntrySchema).max(50).optional(),
  /** Mint a fresh 32-byte HMAC secret and return it once. */
  regenerateHmac: z.boolean().optional(),
  /** Remove the HMAC secret (guard then only warns on missing signature). */
  clearHmac: z.boolean().optional(),
});

export type ApiKeySecurityResult = {
  key: ApiKeyRow;
  /** Present only when a new signing secret was minted. Shown once. */
  hmacSecret?: string;
};

export const updateApiKeySecurity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof securitySchema>) => securitySchema.parse(input))
  .handler(async ({ context, data }): Promise<ApiKeySecurityResult> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    if (data.regenerateHmac && data.clearHmac) httpError(400, "hmac_conflict");

    const existing = await context.supabase
      .from("api_keys")
      .select("id, name, revoked_at")
      .eq("id", data.keyId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const current = existing.data as { revoked_at: string | null } | null;
    if (!current) httpError(404, "key_not_found");
    if (current!.revoked_at) httpError(409, "key_revoked");

    const patch: Record<string, unknown> = {};
    if (data.allowedIps) {
      patch.allowed_ips = Array.from(new Set(data.allowedIps.filter(Boolean)));
    }
    let hmacSecret: string | undefined;
    if (data.regenerateHmac) {
      const bytes = new Uint8Array(32); // 32 random bytes, per operator policy
      crypto.getRandomValues(bytes);
      hmacSecret = base64Url(bytes);
      patch.hmac_secret = hmacSecret;
    } else if (data.clearHmac) {
      patch.hmac_secret = null;
    }
    if (Object.keys(patch).length === 0) httpError(400, "nothing_to_update");

    const { data: updated, error } = await context.supabase
      .from("api_keys")
      .update(patch as never)
      .eq("id", data.keyId)
      .eq("company_id", companyId)
      .select(`${SAFE_SELECT}, allowed_ips, hmac_secret`)
      .single();
    if (error) {
      if ((error as { code?: string }).code === "42501") httpError(403, "forbidden_role");
      throw error;
    }

    const { hmac_secret, ...row } = updated as { hmac_secret: string | null } & Omit<
      ApiKeyRow,
      "status" | "has_hmac"
    >;
    await writeAudit(context, companyId, "api_key.security_updated", row.id, {
      name: row.name,
      prefix: row.key_prefix,
      allowed_ips: data.allowedIps ?? undefined,
      hmac: data.regenerateHmac ? "regenerated" : data.clearHmac ? "cleared" : "unchanged",
    });

    return {
      key: {
        ...row,
        scopes: (row.scopes ?? []) as ApiKeyScope[],
        allowed_ips: (row.allowed_ips ?? []) as string[],
        has_hmac: !!hmac_secret,
        status: statusOf(row),
      },
      hmacSecret,
    };
  });
