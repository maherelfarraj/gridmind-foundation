// P-115 — Investor share links: server functions.
//
// - Admin CRUD (list/create/revoke) is authenticated + company_admin only.
// - Public resolve is unauthenticated: it calls the SECURITY DEFINER RPC via
//   a server publishable client so RLS/grants match the anon caller.
// - Photo signed URLs are minted server-side with the admin client so the
//   raw storage path is never exposed to the browser (the RPC returns only
//   paths; the server function signs them).
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const SHARE_ROLES = ["investor_viewer", "lender_viewer"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const SHARE_SECTIONS = ["kpis", "milestones", "photos", "financials"] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];

export const EXPIRY_PRESETS = ["7d", "30d", "90d"] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number];

export type ShareLinkStatus = "active" | "expired" | "revoked";

export interface ShareLinkAdminRow {
  id: string;
  label: string;
  role: ShareRole;
  scope: { project_ids: string[]; sections: ShareSection[] };
  project_names: string[];
  expires_at: string;
  revoked_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_by_email: string | null;
  created_at: string;
  status: ShareLinkStatus;
}

export interface ShareLinkPhoto {
  id: string;
  project_id: string;
  signed_url: string | null;
  caption: string | null;
  taken_at: string | null;
}

export interface ShareLinkFeed {
  ok: true;
  role: ShareRole;
  label: string;
  expires_at: string;
  sections: ShareSection[];
  company: {
    id: string;
    name: string;
    branding: {
      logo_url: string | null;
      primary_color: string | null;
      accent_color: string | null;
      footer_text: string | null;
    };
  };
  projects: Array<{ id: string; name: string; phase: string | null }>;
  milestones?: Array<{
    id: string;
    project_id: string;
    phase: string;
    status: string | null;
    planned_date: string | null;
    actual_date: string | null;
    notes: string | null;
  }>;
  photos?: ShareLinkPhoto[];
  kpis?: Array<{
    project_id: string;
    as_of_date: string | null;
    spi: number | null;
    cpi: number | null;
    pv: number | null;
    ev: number | null;
    ac: number | null;
    bac: number | null;
  }>;
  financials?: Array<{
    project_id: string;
    currency_code: string | null;
    inflow_total: number;
    outflow_total: number;
    net: number;
  }>;
}

export type ShareLinkResolveResult =
  | ShareLinkFeed
  | { ok: false; reason: "invalid" | "revoked" | "expired" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function assertCompanyAdmin(context: AuthContext): Promise<string> {
  const { data: isAdmin, error: roleErr } = await context.supabase.rpc(
    "has_company_role",
    { p_role: "company_admin" },
  );
  if (roleErr) throw roleErr;
  if (!isAdmin) httpError(403, "forbidden");
  const { data: prof, error: profErr } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (profErr) throw profErr;
  const cid = (prof as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

function deriveStatus(row: {
  expires_at: string;
  revoked_at: string | null;
}): ShareLinkStatus {
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

function expiryFromPreset(p: ExpiryPreset): string {
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "investor_share_links",
      p_entity_id: entityId,
      p_metadata: metadata as unknown as Json,
    });
  } catch {
    /* never fail on audit */
  }
}

// ---------------------------------------------------------------------------
// listShareLinks
// ---------------------------------------------------------------------------

export const listShareLinks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ShareLinkAdminRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await assertCompanyAdmin(context);

    const { data, error } = await context.supabase
      .from("investor_share_links")
      .select(
        "id, label, role, scope, expires_at, revoked_at, last_accessed_at, access_count, created_at, created_by",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as Array<any>;
    const allProjectIds = new Set<string>();
    const allCreatorIds = new Set<string>();
    for (const r of rows) {
      const pids = (r.scope?.project_ids ?? []) as string[];
      for (const pid of pids) allProjectIds.add(pid);
      if (r.created_by) allCreatorIds.add(r.created_by);
    }

    const projectNames = new Map<string, string>();
    if (allProjectIds.size > 0) {
      const { data: projs } = await context.supabase
        .from("projects")
        .select("id, name")
        .in("id", Array.from(allProjectIds));
      for (const p of (projs ?? []) as Array<{ id: string; name: string }>) {
        projectNames.set(p.id, p.name);
      }
    }

    const creatorEmails = new Map<string, string | null>();
    if (allCreatorIds.size > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, email")
        .in("id", Array.from(allCreatorIds));
      for (const p of (profs ?? []) as Array<{ id: string; email: string | null }>) {
        creatorEmails.set(p.id, p.email);
      }
    }

    return rows.map((r) => {
      const scope = {
        project_ids: (r.scope?.project_ids ?? []) as string[],
        sections: (r.scope?.sections ?? []) as ShareSection[],
      };
      return {
        id: r.id,
        label: r.label,
        role: r.role as ShareRole,
        scope,
        project_names: scope.project_ids
          .map((pid) => projectNames.get(pid))
          .filter((n): n is string => Boolean(n)),
        expires_at: r.expires_at,
        revoked_at: r.revoked_at,
        last_accessed_at: r.last_accessed_at,
        access_count: r.access_count,
        created_by_email: r.created_by ? creatorEmails.get(r.created_by) ?? null : null,
        created_at: r.created_at,
        status: deriveStatus(r),
      };
    });
  });

// ---------------------------------------------------------------------------
// createShareLink
// ---------------------------------------------------------------------------

const createSchema = z.object({
  label: z.string().trim().min(3).max(120),
  role: z.enum(SHARE_ROLES),
  projectIds: z.array(z.string().uuid()).min(1).max(50),
  sections: z.array(z.enum(SHARE_SECTIONS)).min(1),
  expiresPreset: z.enum(EXPIRY_PRESETS),
});

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => createSchema.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string; token: string; url: string; expires_at: string }> => {
      requireSupabaseAuth(context);
      const companyId = await assertCompanyAdmin(context);

      // Validate projects belong to the caller's company.
      const { data: valid, error: valErr } = await context.supabase
        .from("projects")
        .select("id")
        .eq("company_id", companyId)
        .in("id", data.projectIds);
      if (valErr) throw valErr;
      const validIds = new Set(((valid ?? []) as Array<{ id: string }>).map((r) => r.id));
      if (validIds.size !== data.projectIds.length) {
        httpError(400, "invalid_project", "One or more projects are not in your company");
      }

      // financials only meaningful for lender_viewer; strip otherwise.
      let sections = Array.from(new Set(data.sections)) as ShareSection[];
      if (data.role !== "lender_viewer") {
        sections = sections.filter((s) => s !== "financials");
      }
      if (sections.length === 0) sections = ["kpis"];

      const token = randomBytes(32).toString("hex");
      const tokenHash = sha256Hex(token);
      const expiresAt = expiryFromPreset(data.expiresPreset);

      const { data: inserted, error: insErr } = await context.supabase
        .from("investor_share_links")
        .insert({
          company_id: companyId,
          label: data.label,
          token_hash: tokenHash,
          role: data.role,
          scope: {
            project_ids: data.projectIds,
            sections,
          } as unknown as Json,
          expires_at: expiresAt,
          created_by: context.user!.id,
        })
        .select("id, expires_at")
        .single();
      if (insErr) throw insErr;

      const row = inserted as { id: string; expires_at: string };

      // Build absolute URL from the current request origin.
      const req = getRequest();
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;
      const shareUrl = `${origin}/share/${token}`;

      await audit(context, "share_link.created", row.id, {
        label: data.label,
        role: data.role,
        project_ids: data.projectIds,
        sections,
        expires_at: row.expires_at,
      });

      return { id: row.id, token, url: shareUrl, expires_at: row.expires_at };
    },
  );

// ---------------------------------------------------------------------------
// revokeShareLink
// ---------------------------------------------------------------------------

const revokeSchema = z.object({ id: z.string().uuid() });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => revokeSchema.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);

    const { data: updated, error } = await context.supabase
      .from("investor_share_links")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.user!.id })
      .eq("id", data.id)
      .is("revoked_at", null)
      .select("id, label")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "not_found_or_already_revoked");

    await audit(context, "share_link.revoked", data.id, {
      label: (updated as any).label,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// resolveShareLink — PUBLIC (no auth). Called from the /share/$token loader.
// ---------------------------------------------------------------------------

const resolveSchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const resolveShareLink = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => resolveSchema.parse(raw))
  .handler(async ({ data }): Promise<ShareLinkResolveResult> => {
    // Never cache this response.
    try {
      setResponseHeader("Cache-Control", "no-store");
      setResponseHeader("Referrer-Policy", "no-referrer");
    } catch {
      /* headers optional if not in a response context */
    }

    // Rate limit per client IP (fail-open).
    const req = getRequest();
    const ipHeader =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("cf-connecting-ip") ??
      "";
    const ip = ipHeader.split(",")[0]?.trim() || "unknown";

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.SUPABASE_URL!;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const isNewKey =
      publishableKey.startsWith("sb_publishable_") ||
      publishableKey.startsWith("sb_secret_");
    const supabasePublic = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (isNewKey && headers.get("Authorization") === `Bearer ${publishableKey}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", publishableKey);
          return fetch(input, { ...init, headers });
        },
      },
    });

    try {
      await supabasePublic.rpc("consume_rate_limit", {
        p_key: `share:${ip}`,
        p_capacity: 30,
        p_refill_per_sec: 0.5,
      });
    } catch {
      /* fail-open */
    }

    const { data: rpcData, error } = await supabasePublic.rpc("resolve_share_link", {
      p_token_hash: data.tokenHash.toLowerCase(),
    });
    if (error) {
      // Don't leak details.
      return { ok: false, reason: "invalid" };
    }
    const payload = rpcData as unknown as ShareLinkResolveResult | null;
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid" };
    }
    if (!("ok" in payload) || payload.ok !== true) {
      return payload as { ok: false; reason: "invalid" | "revoked" | "expired" };
    }

    // Sign photo storage paths server-side.
    if (payload.photos && payload.photos.length > 0) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const signed = await Promise.all(
          payload.photos.map(async (p: any) => {
            try {
              const path = p.storage_path as string;
              const { data: sig } = await supabaseAdmin.storage
                .from("photos")
                .createSignedUrl(path, 900);
              return {
                id: p.id,
                project_id: p.project_id,
                signed_url: sig?.signedUrl ?? null,
                caption: p.caption ?? null,
                taken_at: p.taken_at ?? null,
              } satisfies ShareLinkPhoto;
            } catch {
              return {
                id: p.id,
                project_id: p.project_id,
                signed_url: null,
                caption: p.caption ?? null,
                taken_at: p.taken_at ?? null,
              } satisfies ShareLinkPhoto;
            }
          }),
        );
        payload.photos = signed;
      } catch {
        payload.photos = [];
      }
    }

    return payload;
  });
