// P-116 — Portal audit events: admin server functions.
//
// The portal_audit_events table is written by portal RPCs (portal_get_feed,
// portal_raise_ticket, portal_decide_approval) and by share-link resolution.
// This module exposes read-only, company_admin-gated queries for the admin
// audit viewer at /settings/portal-audit.
import { createServerFn } from "@tanstack/react-start";
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

export const PORTAL_AUDIT_EVENTS = [
  "portal.feed_viewed",
  "portal.ticket_raised",
  "portal.approval_decided",
  "share_link.viewed",
] as const;
export type PortalAuditEvent = (typeof PORTAL_AUDIT_EVENTS)[number];

export interface PortalAuditRow {
  id: string;
  created_at: string;
  event: string;
  project_id: string;
  project_name: string | null;
  membership_id: string | null;
  membership_email: string | null;
  actor_id: string | null;
  actor_email: string | null;
  metadata: Json;
}

export interface PortalAuditSummary {
  total: number;
  by_event: Record<string, number>;
  unique_actors: number;
  since: string;
}

export interface PortalAuditPage {
  rows: PortalAuditRow[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function assertCompanyAdmin(context: AuthContext): Promise<void> {
  for (const role of ["company_admin", "super_admin"] as const) {
    const { data } = await context.supabase.rpc("has_company_role", {
      p_role: role,
    });
    if (data === true) return;
  }
  throw Object.assign(new Error("forbidden_role"), { statusCode: 403 });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id?: string } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 403 });
  return cid;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// List (cursor-paginated)
// ---------------------------------------------------------------------------

const listInput = z.object({
  projectId: z.string().uuid().optional(),
  membershipId: z.string().uuid().optional(),
  events: z.array(z.string().max(64)).max(10).optional(),
  days: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
});

export const listPortalAuditEvents = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalAuditPage> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    let q = context.supabase
      .from("portal_audit_events")
      .select("id, created_at, event, project_id, membership_id, actor_id, metadata")
      .eq("company_id", companyId)
      .gte("created_at", sinceIso(data.days))
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);

    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.membershipId) q = q.eq("membership_id", data.membershipId);
    if (data.events && data.events.length > 0) q = q.in("event", data.events);
    if (data.cursor) q = q.lt("created_at", data.cursor);

    const { data: raw, error } = await q;
    if (error) throw error;
    const rows = (raw ?? []) as Array<{
      id: string;
      created_at: string;
      event: string;
      project_id: string;
      membership_id: string | null;
      actor_id: string | null;
      metadata: Json;
    }>;

    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    // Enrich with project name, membership email, actor email.
    const projectIds = Array.from(new Set(page.map((r) => r.project_id)));
    const membershipIds = Array.from(
      new Set(page.map((r) => r.membership_id).filter((v): v is string => Boolean(v))),
    );
    const actorIds = Array.from(
      new Set(page.map((r) => r.actor_id).filter((v): v is string => Boolean(v))),
    );

    const [projRes, memRes, actorRes] = await Promise.all([
      projectIds.length
        ? context.supabase.from("projects").select("id, name").in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      membershipIds.length
        ? context.supabase.from("portal_memberships").select("id, email").in("id", membershipIds)
        : Promise.resolve({ data: [], error: null }),
      actorIds.length
        ? context.supabase.from("profiles").select("id, email").in("id", actorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const projMap = new Map<string, string | null>();
    for (const p of (projRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      projMap.set(p.id, p.name);
    }
    const memMap = new Map<string, string | null>();
    for (const m of (memRes.data ?? []) as Array<{ id: string; email: string | null }>) {
      memMap.set(m.id, m.email);
    }
    const actorMap = new Map<string, string | null>();
    for (const a of (actorRes.data ?? []) as Array<{ id: string; email: string | null }>) {
      actorMap.set(a.id, a.email);
    }

    const enriched: PortalAuditRow[] = page.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      event: r.event,
      project_id: r.project_id,
      project_name: projMap.get(r.project_id) ?? null,
      membership_id: r.membership_id,
      membership_email: r.membership_id ? (memMap.get(r.membership_id) ?? null) : null,
      actor_id: r.actor_id,
      actor_email: r.actor_id ? (actorMap.get(r.actor_id) ?? null) : null,
      metadata: r.metadata,
    }));

    return {
      rows: enriched,
      next_cursor: hasMore ? page[page.length - 1]!.created_at : null,
    };
  });

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

const summaryInput = z.object({
  projectId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(365).default(30),
});

export const getPortalAuditSummary = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => summaryInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalAuditSummary> => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);
    const since = sinceIso(data.days);

    let q = context.supabase
      .from("portal_audit_events")
      .select("event, actor_id, membership_id")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .limit(5000);
    if (data.projectId) q = q.eq("project_id", data.projectId);

    const { data: rows, error } = await q;
    if (error) throw error;

    const by_event: Record<string, number> = {};
    const actors = new Set<string>();
    for (const r of (rows ?? []) as Array<{
      event: string;
      actor_id: string | null;
      membership_id: string | null;
    }>) {
      by_event[r.event] = (by_event[r.event] ?? 0) + 1;
      const who = r.actor_id ?? r.membership_id;
      if (who) actors.add(who);
    }
    return {
      total: (rows ?? []).length,
      by_event,
      unique_actors: actors.size,
      since,
    };
  });

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

export const listPortalAuditProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({ context }): Promise<Array<{ id: string; name: string; code: string | null }>> => {
      requireSupabaseAuth(context);
      await assertCompanyAdmin(context);
      const companyId = await currentCompanyId(context);
      const { data, error } = await context.supabase
        .from("projects")
        .select("id, name, code")
        .eq("company_id", companyId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; code: string | null }>;
    },
  );

export const listPortalAuditMemberships = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(raw),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<Array<{ id: string; email: string; project_id: string; role: string }>> => {
      requireSupabaseAuth(context);
      await assertCompanyAdmin(context);
      const companyId = await currentCompanyId(context);
      let q = context.supabase
        .from("portal_memberships")
        .select("id, email, project_id, role")
        .eq("company_id", companyId)
        .order("email");
      if (data.projectId) q = q.eq("project_id", data.projectId);
      const { data: rows, error } = await q;
      if (error) throw error;
      return (rows ?? []) as Array<{
        id: string;
        email: string;
        project_id: string;
        role: string;
      }>;
    },
  );
