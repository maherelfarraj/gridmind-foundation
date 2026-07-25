// P-125 — Webhook admin server functions: endpoints CRUD, deliveries viewer,
// test-event trigger, export allowlist toggle.
//
// SECURITY MODEL
//   - RLS on webhook_endpoints (company_admin write, company_member read) and
//     webhook_export_allowlist (same shape) is the DB backstop.
//   - Every mutation ALSO re-checks has_company_role('company_admin')
//     server-side — belt & braces, per the P-124/P-125 spec.
//   - Raw endpoint signing secrets are minted server-side, hashed with
//     SHA-256 for `webhook_endpoints.signing_secret_hash`, and the raw value
//     is stored in `webhook_endpoint_secrets` (service-role only). The raw
//     value is returned to the UI ONCE at create/rotate time.
//   - Every mutation writes an audit_logs row.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

// ---------- shared types ---------------------------------------------------

export type WebhookEndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WebhookDeliveryRow = {
  id: string;
  endpoint_id: string;
  event: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  response_status: number | null;
  response_body: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
  payload: unknown;
};

export type CreatedEndpointResult = {
  endpoint: WebhookEndpointRow;
  /** Raw signing secret — shown ONCE. */
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

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateSigningSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${base64Url(bytes)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function writeAudit(
  ctx: AuthContext,
  companyId: string,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ctx.supabase.from("audit_logs").insert({
    company_id: companyId,
    actor_id: ctx.user!.id,
    action,
    entity: "webhook_endpoints",
    entity_id: entityId,
    metadata,
  } as never);
}

const ENDPOINT_SELECT =
  "id, url, description, events, is_active, created_at, updated_at";

// URL must be https-only. Rejects http://, ws://, javascript:, data:, etc.
const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:";
    } catch {
      return false;
    }
  }, "url_must_be_https");

const eventsSchema = z
  .array(z.string().trim().min(3).max(80).regex(/^[a-z0-9._*-]+$/i))
  .min(1, "at least one event")
  .max(64)
  .transform((arr) => Array.from(new Set(arr)));

// ---------- endpoints: list -----------------------------------------------

export const listWebhookEndpoints = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<WebhookEndpointRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("webhook_endpoints")
      .select(ENDPOINT_SELECT)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as WebhookEndpointRow[];
  });

// ---------- endpoints: create ---------------------------------------------

const createEndpointSchema = z.object({
  url: httpsUrlSchema,
  description: z.string().trim().max(500).nullable().optional().transform((v) => v ?? null),
  events: eventsSchema,
  isActive: z.boolean().default(true),
});

export const createWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof createEndpointSchema>) =>
    createEndpointSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<CreatedEndpointResult> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const raw = generateSigningSecret();
    const hash = await sha256Hex(raw);

    // 1) Insert endpoint under the caller's identity (RLS + audit trail
    //    tie the row to a real user).
    const ins = await context.supabase
      .from("webhook_endpoints")
      .insert({
        company_id: companyId,
        url: data.url,
        description: data.description,
        events: data.events,
        is_active: data.isActive,
        signing_secret_hash: hash,
        created_by: context.user!.id,
      } as never)
      .select(ENDPOINT_SELECT)
      .single();
    if (ins.error) throw ins.error;
    const endpoint = ins.data as WebhookEndpointRow;

    // 2) Stash the raw secret in webhook_endpoint_secrets via service role
    //    (no user has read access to this table).
    const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
    const admin = createServiceRoleClient();
    const sec = await admin.from("webhook_endpoint_secrets").insert({
      endpoint_id: endpoint.id,
      company_id: companyId,
      secret: raw,
    } as never);
    if (sec.error) {
      // Rollback the endpoint row so we don't leave a signing-secret-less
      // endpoint behind (dispatcher would skip it forever).
      await context.supabase.from("webhook_endpoints").delete().eq("id", endpoint.id);
      throw sec.error;
    }

    await writeAudit(context, companyId, "webhook_endpoint.created", endpoint.id, {
      url: data.url,
      events: data.events,
      is_active: data.isActive,
    });

    return { endpoint, raw };
  });

// ---------- endpoints: update ---------------------------------------------

const updateEndpointSchema = z.object({
  id: z.string().uuid(),
  url: httpsUrlSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  events: eventsSchema.optional(),
  isActive: z.boolean().optional(),
});

export const updateWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof updateEndpointSchema>) =>
    updateEndpointSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<WebhookEndpointRow> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const patch: Record<string, unknown> = {};
    if (data.url !== undefined) patch.url = data.url;
    if (data.description !== undefined) patch.description = data.description;
    if (data.events !== undefined) patch.events = data.events;
    if (data.isActive !== undefined) patch.is_active = data.isActive;

    const { data: row, error } = await context.supabase
      .from("webhook_endpoints")
      .update(patch as never)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select(ENDPOINT_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "endpoint_not_found");

    await writeAudit(context, companyId, "webhook_endpoint.updated", data.id, patch);
    return row as WebhookEndpointRow;
  });

// ---------- endpoints: rotate secret --------------------------------------

const rotateEndpointSchema = z.object({ id: z.string().uuid() });

export const rotateWebhookEndpointSecret = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof rotateEndpointSchema>) =>
    rotateEndpointSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<CreatedEndpointResult> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const raw = generateSigningSecret();
    const hash = await sha256Hex(raw);

    const upd = await context.supabase
      .from("webhook_endpoints")
      .update({ signing_secret_hash: hash } as never)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select(ENDPOINT_SELECT)
      .maybeSingle();
    if (upd.error) throw upd.error;
    if (!upd.data) httpError(404, "endpoint_not_found");

    const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
    const admin = createServiceRoleClient();
    const sec = await admin
      .from("webhook_endpoint_secrets")
      .upsert(
        {
          endpoint_id: data.id,
          company_id: companyId,
          secret: raw,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "endpoint_id" },
      );
    if (sec.error) throw sec.error;

    await writeAudit(context, companyId, "webhook_endpoint.rotated", data.id, {
      url: (upd.data as WebhookEndpointRow).url,
    });

    return { endpoint: upd.data as WebhookEndpointRow, raw };
  });

// ---------- endpoints: delete ---------------------------------------------

const deleteEndpointSchema = z.object({ id: z.string().uuid() });

export const deleteWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteEndpointSchema>) =>
    deleteEndpointSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const del = await context.supabase
      .from("webhook_endpoints")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (del.error) throw del.error;
    if (!del.data) httpError(404, "endpoint_not_found");

    // webhook_endpoint_secrets cascades via FK ON DELETE CASCADE.
    await writeAudit(context, companyId, "webhook_endpoint.deleted", data.id, {});
    return { id: data.id };
  });

// ---------- deliveries: list ----------------------------------------------

const listDeliveriesSchema = z.object({
  endpointId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listWebhookDeliveries = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof listDeliveriesSchema>) =>
    listDeliveriesSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<WebhookDeliveryRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: rows, error } = await context.supabase
      .from("webhook_deliveries")
      .select(
        "id, endpoint_id, event, status, attempts, response_status, response_body, next_retry_at, delivered_at, created_at, payload",
      )
      .eq("company_id", companyId)
      .eq("endpoint_id", data.endpointId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return (rows ?? []) as WebhookDeliveryRow[];
  });

// ---------- test event ----------------------------------------------------

const sendTestSchema = z.object({ endpointId: z.string().uuid() });

export const sendWebhookTestEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof sendTestSchema>) => sendTestSchema.parse(input))
  .handler(async ({ context, data }): Promise<{ deliveryId: string }> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    // Confirm ownership + endpoint is active.
    const ep = await context.supabase
      .from("webhook_endpoints")
      .select("id, is_active, url")
      .eq("id", data.endpointId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (ep.error) throw ep.error;
    if (!ep.data) httpError(404, "endpoint_not_found");
    if ((ep.data as { is_active: boolean }).is_active !== true) {
      httpError(409, "endpoint_inactive");
    }

    // Enqueue delivery via the shared emit helper (bypass allowlist —
    // "webhook.test" is a system event not tied to a table row).
    const { emitWebhookEvent } = await import("@/lib/webhooks/emit.server");
    const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
    const admin = createServiceRoleClient();

    // Direct insert (single target = this endpoint only, regardless of its
    // subscribed events).
    const payload = {
      event: "webhook.test",
      table: null,
      company_id: companyId,
      emitted_at: new Date().toISOString(),
      data: { message: "Test event from GridMind EPC settings page." },
    };
    const ins = await admin
      .from("webhook_deliveries")
      .insert({
        endpoint_id: data.endpointId,
        company_id: companyId,
        event: "webhook.test",
        payload,
        status: "pending" as const,
        attempts: 0,
        next_retry_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (ins.error) {
      // Fall back to allowlist-bypass emit (which would be a no-op if this
      // endpoint isn't subscribed) — retained for symmetry / future use.
      await emitWebhookEvent(companyId, null, "webhook.test", payload.data, {
        bypassAllowlist: true,
      });
      throw ins.error;
    }
    await writeAudit(context, companyId, "webhook_endpoint.test_sent", data.endpointId, {
      delivery_id: (ins.data as { id: string }).id,
    });
    return { deliveryId: (ins.data as { id: string }).id };
  });

// ---------- allowlist: list -----------------------------------------------

export type AllowlistRow = { table_name: string; is_enabled: boolean };

export const listWebhookAllowlist = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<AllowlistRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("webhook_export_allowlist")
      .select("table_name, is_enabled")
      .eq("company_id", companyId);
    if (error) throw error;
    return (data ?? []) as AllowlistRow[];
  });

// ---------- allowlist: set ------------------------------------------------

const setAllowlistSchema = z.object({
  table: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});

export const setWebhookAllowlistEntry = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: z.input<typeof setAllowlistSchema>) =>
    setAllowlistSchema.parse(input),
  )
  .handler(async ({ context, data }): Promise<AllowlistRow> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    const { EXPORTABLE_TABLE_NAMES } = await import("@/lib/public-api/export-allowlist");
    if (!EXPORTABLE_TABLE_NAMES.has(data.table)) httpError(400, "table_not_exportable");

    const up = await context.supabase
      .from("webhook_export_allowlist")
      .upsert(
        {
          company_id: companyId,
          table_name: data.table,
          is_enabled: data.enabled,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "company_id,table_name" },
      )
      .select("table_name, is_enabled")
      .single();
    if (up.error) throw up.error;

    await context.supabase.from("audit_logs").insert({
      company_id: companyId,
      actor_id: context.user!.id,
      action: data.enabled
        ? "webhook_allowlist.enabled"
        : "webhook_allowlist.disabled",
      entity: "webhook_export_allowlist",
      entity_id: null,
      metadata: { table: data.table, enabled: data.enabled },
    } as never);

    return up.data as AllowlistRow;
  });
