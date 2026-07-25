// P-114 — Portal server functions.
//
// SECURITY: portal UI code MUST call these wrappers and never query source
// tables (site_photos, project_phase_gates, projects, evm_snapshots, etc.)
// directly. Data curation happens inside the SECURITY DEFINER RPCs.
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

export type PortalRole = "client_viewer" | "investor_viewer" | "lender_viewer";
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface PortalExposure {
  milestones: boolean;
  kpis: boolean;
  photos: boolean;
  documents: boolean;
  financials: boolean;
  tickets: boolean;
  approvals: boolean;
}

export const DEFAULT_EXPOSURE: PortalExposure = {
  milestones: true,
  kpis: true,
  photos: true,
  documents: false,
  financials: false,
  tickets: true,
  approvals: true,
};

export const EXPOSURE_KEYS = [
  "milestones",
  "kpis",
  "photos",
  "documents",
  "financials",
  "tickets",
  "approvals",
] as const;

export function normalizeExposure(raw: unknown): PortalExposure {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_EXPOSURE };
  for (const k of EXPOSURE_KEYS) {
    if (typeof src[k] === "boolean") out[k] = src[k] as boolean;
  }
  return out;
}

export interface PortalMembershipSummary {
  id: string;
  project_id: string;
  project_name: string | null;
  project_code: string | null;
  company_id: string;
  company_name: string | null;
  role: PortalRole;
  status: MembershipStatus;
  exposure: PortalExposure;
  expires_at: string | null;
  last_seen_at: string | null;
}

export interface PortalMemberAdminRow {
  id: string;
  email: string;
  role: PortalRole;
  status: MembershipStatus;
  exposure: PortalExposure;
  expires_at: string | null;
  last_seen_at: string | null;
  accepted_at: string | null;
  invited_by: string | null;
  user_id: string | null;
  invite_id: string | null;
  created_at: string;
}

export interface PortalFeed {
  membership_id: string;
  project: {
    id?: string;
    name?: string | null;
    code?: string | null;
    phase?: string | null;
    status?: string | null;
  };
  exposure: PortalExposure;
  as_of: string;
  milestones?: Array<{
    id: string;
    phase: string;
    status: string | null;
    planned_date: string | null;
    actual_date: string | null;
    notes: string | null;
  }>;
  kpis?: {
    as_of_date?: string | null;
    spi?: number | null;
    cpi?: number | null;
    pv?: number | null;
    ev?: number | null;
    ac?: number | null;
    eac?: number | null;
    etc?: number | null;
  };
  photos?: Array<{
    id: string;
    storage_path: string;
    caption: string | null;
    taken_at: string | null;
    discipline: string | null;
  }>;
}

export interface PortalApprovalRow {
  approval_id: string;
  instance_id: string;
  status: "pending" | "approved" | "rejected" | "skipped";
  comment: string | null;
  decided_at: string | null;
  due_at: string | null;
  step_order: number;
  entity_type: string;
  entity_id: string;
  rule_key: string | null;
  amount: number | null;
  metadata: Json;
  requested_at: string;
  sla_due_at: string | null;
  instance_status: string;
  title: string;
}

export interface PortalTicketRow {
  id: string;
  subject: string;
  body: string | null;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  resolved_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickTitle(metadata: Json | null | undefined, entity: string, id: string): string {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const obj = metadata as Record<string, unknown>;
    for (const k of ["title", "name", "reference", "po_number", "contract_number"]) {
      const v = obj[k];
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
  }
  return `${entity} ${id.slice(0, 8)}`;
}

async function assertPortalAdmin(context: AuthContext): Promise<void> {
  for (const role of ["company_admin", "project_admin"] as const) {
    const { data } = await context.supabase.rpc("has_company_role", {
      p_role: role,
    });
    if (data === true) return;
  }
  throw Object.assign(new Error("forbidden_role"), { statusCode: 403 });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const uid = context.user!.id;
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id?: string } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 403 });
  return cid;
}

// ---------------------------------------------------------------------------
// PORTAL USER: my memberships / feed / tickets / approvals
// ---------------------------------------------------------------------------

export const listMyPortalMemberships = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortalMembershipSummary[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("portal_memberships")
      .select(
        "id, project_id, company_id, role, status, exposure, expires_at, last_seen_at",
      )
      .eq("user_id", context.user.id)
      .eq("status", "active")
      .order("last_seen_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      id: string;
      project_id: string;
      company_id: string;
      role: PortalRole;
      status: MembershipStatus;
      exposure: Json;
      expires_at: string | null;
      last_seen_at: string | null;
    }>;
    if (rows.length === 0) return [];

    const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
    const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));

    const [projRes, coRes] = await Promise.all([
      context.supabase
        .from("projects")
        .select("id, name, code")
        .in("id", projectIds),
      context.supabase.from("companies").select("id, name").in("id", companyIds),
    ]);

    const projMap = new Map<string, { name: string | null; code: string | null }>();
    for (const p of (projRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      code: string | null;
    }>) {
      projMap.set(p.id, { name: p.name, code: p.code });
    }
    const coMap = new Map<string, string | null>();
    for (const c of (coRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      coMap.set(c.id, c.name);
    }

    return rows
      .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now())
      .map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_name: projMap.get(r.project_id)?.name ?? null,
        project_code: projMap.get(r.project_id)?.code ?? null,
        company_id: r.company_id,
        company_name: coMap.get(r.company_id) ?? null,
        role: r.role,
        status: r.status,
        exposure: normalizeExposure(r.exposure),
        expires_at: r.expires_at,
        last_seen_at: r.last_seen_at,
      }));
  });

const projectIdInput = z.object({ projectId: z.string().uuid() });

export const getPortalFeed = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => projectIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalFeed> => {
    requireSupabaseAuth(context);
    const { data: feed, error } = await context.supabase.rpc("portal_get_feed", {
      p_project_id: data.projectId,
    });
    if (error) throw error;
    const raw = (feed ?? {}) as Record<string, unknown>;
    return {
      membership_id: String(raw.membership_id ?? ""),
      project: (raw.project ?? {}) as PortalFeed["project"],
      exposure: normalizeExposure(raw.exposure),
      as_of: String(raw.as_of ?? new Date().toISOString()),
      milestones: (raw.milestones as PortalFeed["milestones"]) ?? undefined,
      kpis: (raw.kpis as PortalFeed["kpis"]) ?? undefined,
      photos: (raw.photos as PortalFeed["photos"]) ?? undefined,
    };
  });

const photoInput = z.object({
  projectId: z.string().uuid(),
  path: z.string().min(1).max(500),
});

export const getPortalPhotoSignedUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => photoInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ url: string }> => {
    requireSupabaseAuth(context);
    // Assert access — throws portal_access_denied if not a member.
    const { error: accErr } = await context.supabase.rpc("portal_assert_access", {
      p_project_id: data.projectId,
    });
    if (accErr) throw accErr;
    const { data: signed, error } = await context.supabase.storage
      .from("photos")
      .createSignedUrl(data.path, 300);
    if (error || !signed) {
      throw Object.assign(new Error("photo_not_found"), { statusCode: 404 });
    }
    return { url: signed.signedUrl };
  });

export const getPortalApprovals = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => projectIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalApprovalRow[]> => {
    requireSupabaseAuth(context);
    // Assert access first.
    const { error: accErr } = await context.supabase.rpc("portal_assert_access", {
      p_project_id: data.projectId,
    });
    if (accErr) throw accErr;

    const { data: rows, error } = await context.supabase
      .from("approvals")
      .select(
        `id, instance_id, status, comment, decided_at, due_at, step_order,
         approval_instances!inner(
           id, entity_type, entity_id, rule_key, amount, metadata,
           requested_at, sla_due_at, status
         )`,
      )
      .eq("approver_id", context.user.id)
      .in("status", ["pending"])
      .order("due_at", { ascending: true, nullsFirst: false });
    if (error) throw error;

    const out: PortalApprovalRow[] = [];
    for (const r of (rows ?? []) as Array<{
      id: string;
      instance_id: string;
      status: PortalApprovalRow["status"];
      comment: string | null;
      decided_at: string | null;
      due_at: string | null;
      step_order: number;
      approval_instances: {
        entity_type: string;
        entity_id: string;
        rule_key: string | null;
        amount: number | null;
        metadata: Json;
        requested_at: string;
        sla_due_at: string | null;
        status: string;
      } | null;
    }>) {
      const inst = r.approval_instances;
      if (!inst) continue;
      const meta = inst.metadata;
      const pidRaw =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>).project_id
          : null;
      const projectId =
        typeof pidRaw === "string"
          ? pidRaw
          : inst.entity_type === "project"
            ? inst.entity_id
            : null;
      if (projectId !== data.projectId) continue;
      out.push({
        approval_id: r.id,
        instance_id: r.instance_id,
        status: r.status,
        comment: r.comment,
        decided_at: r.decided_at,
        due_at: r.due_at,
        step_order: r.step_order,
        entity_type: inst.entity_type,
        entity_id: inst.entity_id,
        rule_key: inst.rule_key,
        amount: inst.amount,
        metadata: inst.metadata,
        requested_at: inst.requested_at,
        sla_due_at: inst.sla_due_at,
        instance_status: inst.status,
        title: pickTitle(inst.metadata, inst.entity_type, inst.entity_id),
      });
    }
    return out;
  });

const decideInput = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).optional().nullable(),
});

export const decidePortalApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => decideInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (
      data.decision === "rejected" &&
      (!data.comment || data.comment.trim().length === 0)
    ) {
      throw Object.assign(new Error("comment_required_on_reject"), {
        statusCode: 400,
      });
    }
    const { error } = await context.supabase.rpc("portal_decide_approval", {
      p_approval_id: data.approvalId,
      p_decision: data.decision,
      p_comment: data.comment ?? "",
    });
    if (error) throw error;
    return { ok: true };
  });

const raiseInput = z.object({
  projectId: z.string().uuid(),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().max(4000).optional().nullable(),
  category: z.string().trim().max(50).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const raisePortalTicket = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => raiseInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const { data: id, error } = await context.supabase.rpc("portal_raise_ticket", {
      p_project_id: data.projectId,
      p_subject: data.subject,
      p_body: data.body ?? "",
      p_category: data.category ?? "general",
      p_priority: data.priority,
    });
    if (error) throw error;
    return { id: String(id) };
  });

export const listMyPortalTickets = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => projectIdInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalTicketRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("portal_tickets")
      .select("id, subject, body, category, priority, status, created_at, resolved_at")
      .eq("project_id", data.projectId)
      .eq("raised_by", context.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (rows ?? []) as PortalTicketRow[];
  });

// ---------------------------------------------------------------------------
// ADMIN: memberships management
// ---------------------------------------------------------------------------

const listMembersInput = z.object({ projectId: z.string().uuid() });

export const listPortalMembers = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listMembersInput.parse(raw))
  .handler(async ({ context, data }): Promise<PortalMemberAdminRow[]> => {
    requireSupabaseAuth(context);
    await assertPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const { data: rows, error } = await context.supabase
      .from("portal_memberships")
      .select(
        "id, email, role, status, exposure, expires_at, last_seen_at, accepted_at, invited_by, user_id, invite_id, created_at",
      )
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((rows ?? []) as Array<PortalMemberAdminRow & { exposure: Json }>).map(
      (r) => ({ ...r, exposure: normalizeExposure(r.exposure) }),
    );
  });

const inviteInput = z.object({
  projectId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["client_viewer", "investor_viewer", "lender_viewer"]),
  exposure: z
    .object({
      milestones: z.boolean().optional(),
      kpis: z.boolean().optional(),
      photos: z.boolean().optional(),
      documents: z.boolean().optional(),
      financials: z.boolean().optional(),
      tickets: z.boolean().optional(),
      approvals: z.boolean().optional(),
    })
    .optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const invitePortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inviteInput.parse(raw))
  .handler(
    async ({
      context,
      data,
    }): Promise<{ membership_id: string; token: string; expires_at: string }> => {
      requireSupabaseAuth(context);
      await assertPortalAdmin(context);
      const companyId = await currentCompanyId(context);

      // Verify project belongs to company.
      const { data: proj } = await context.supabase
        .from("projects")
        .select("id, company_id")
        .eq("id", data.projectId)
        .maybeSingle();
      if (!proj || (proj as { company_id?: string }).company_id !== companyId) {
        throw Object.assign(new Error("project_not_found"), { statusCode: 404 });
      }

      // Create invite (returns raw token).
      const { data: token, error: invErr } = await context.supabase.rpc(
        "create_invite",
        {
          p_company_id: companyId,
          p_email: data.email,
          p_role: data.role,
        },
      );
      if (invErr) throw invErr;

      // Find that invite row for FK linkage.
      const { data: inviteRow } = await context.supabase
        .from("invites")
        .select("id")
        .eq("company_id", companyId)
        .eq("email", data.email)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const expiresAt = new Date(
        Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const exposure = { ...DEFAULT_EXPOSURE, ...(data.exposure ?? {}) };

      const { data: upserted, error: upErr } = await context.supabase
        .from("portal_memberships")
        .upsert(
          {
            company_id: companyId,
            project_id: data.projectId,
            email: data.email,
            role: data.role,
            exposure: exposure as unknown as Json,
            status: "invited",
            invite_id: (inviteRow as { id?: string } | null)?.id ?? null,
            invited_by: context.user.id,
            expires_at: expiresAt,
            accepted_at: null,
            user_id: null,
          },
          { onConflict: "company_id,project_id,email" },
        )
        .select("id")
        .single();
      if (upErr) throw upErr;

      await context.supabase.rpc("write_audit_log", {
        p_action: "portal.member_invited",
        p_entity: "portal_memberships",
        p_entity_id: (upserted as { id: string }).id,
        p_metadata: {
          project_id: data.projectId,
          email: data.email,
          role: data.role,
          expires_at: expiresAt,
        } as unknown as Json,
      });

      return {
        membership_id: (upserted as { id: string }).id,
        token: String(token),
        expires_at: expiresAt,
      };
    },
  );

const idInput = z.object({ id: z.string().uuid() });

async function statusMutation(
  context: AuthContext,
  id: string,
  status: MembershipStatus,
  auditAction: string,
) {
  requireSupabaseAuth(context);
  await assertPortalAdmin(context);
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("portal_memberships")
    .update({ status })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id, project_id, email")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  await context.supabase.rpc("write_audit_log", {
    p_action: auditAction,
    p_entity: "portal_memberships",
    p_entity_id: id,
    p_metadata: {
      project_id: (data as { project_id: string }).project_id,
      email: (data as { email: string }).email,
    } as unknown as Json,
  });
  return { ok: true as const };
}

export const suspendPortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(({ context, data }) =>
    statusMutation(context, data.id, "suspended", "portal.member_suspended"),
  );

export const revokePortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(({ context, data }) =>
    statusMutation(context, data.id, "revoked", "portal.member_revoked"),
  );

export const reactivatePortalMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(({ context, data }) =>
    statusMutation(context, data.id, "active", "portal.member_reactivated"),
  );

const exposureInput = z.object({
  id: z.string().uuid(),
  exposure: z.object({
    milestones: z.boolean(),
    kpis: z.boolean(),
    photos: z.boolean(),
    documents: z.boolean(),
    financials: z.boolean(),
    tickets: z.boolean(),
    approvals: z.boolean(),
  }),
});

export const updatePortalMemberExposure = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => exposureInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertPortalAdmin(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("portal_memberships")
      .update({ exposure: data.exposure as unknown as Json })
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await context.supabase.rpc("write_audit_log", {
      p_action: "portal.exposure_updated",
      p_entity: "portal_memberships",
      p_entity_id: data.id,
      p_metadata: data.exposure as unknown as Json,
    });
    return { ok: true };
  });

// List admin projects for the picker in /settings/portal-members.
export const listAdminProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({ context }): Promise<Array<{ id: string; name: string; code: string | null }>> => {
      requireSupabaseAuth(context);
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
