// P-058 — Drawing review workflow server functions.
// All mutations RLS-scoped via attachSupabaseAuth. Governance: IFC blocked
// until every reviewer for the latest IFD revision has a decision.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// constants + errors
// ---------------------------------------------------------------------------
export const REVIEWER_ORGS = [
  "client",
  "lender",
  "utility",
  "internal",
] as const;
export type ReviewerOrg = (typeof REVIEWER_ORGS)[number];

export const REVIEW_DECISIONS = [
  "approved",
  "approved_with_comments",
  "rejected",
] as const;
export type ReviewDecisionInput = (typeof REVIEW_DECISIONS)[number];

const ROUND_ADMIN_ROLES = [
  "engineering_admin",
  "project_admin",
  "super_admin",
] as const;
const WAIVE_ROLES = ["engineering_admin", "super_admin"] as const;
const ELIGIBLE_REVIEWER_ROLES = [
  "client_viewer",
  "lender_viewer",
  "engineer",
  "engineering_admin",
  "project_admin",
] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProjectCompany(context: any, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string };
}

async function loadRevision(context: any, revisionId: string) {
  const { data, error } = await context.supabase
    .from("drawing_revisions")
    .select(
      "id, drawing_id, status, revision_code, drawing_register:drawing_register!inner (id, company_id, project_id, drawing_number, title)",
    )
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "revision_not_found");
  const draw = (data as any).drawing_register;
  return {
    id: (data as any).id as string,
    drawing_id: (data as any).drawing_id as string,
    status: (data as any).status as string,
    revision_code: (data as any).revision_code as string,
    company_id: draw.company_id as string,
    project_id: draw.project_id as string,
    drawing_number: draw.drawing_number as string,
    drawing_title: draw.title as string,
  };
}

async function loadRoundWithContext(context: any, roundId: string) {
  const { data, error } = await context.supabase
    .from("drawing_review_rounds")
    .select("id, company_id, project_id, revision_id, round_no, status, due_date, created_by, created_at, updated_at")
    .eq("id", roundId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "round_not_found");
  return data as {
    id: string;
    company_id: string;
    project_id: string;
    revision_id: string;
    round_no: number;
    status: "open" | "closed" | "waived";
    due_date: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
}

async function assertRole(
  context: any,
  companyId: string,
  roles: readonly string[],
) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", roles as any)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) httpError(403, "forbidden");
}

async function audit(
  context: any,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    // Never break the write on audit failure.
  }
}

// ---------------------------------------------------------------------------
// Types returned to UI
// ---------------------------------------------------------------------------
export interface ReviewRoundRow {
  id: string;
  project_id: string;
  revision_id: string;
  drawing_id: string;
  drawing_number: string;
  drawing_title: string;
  revision_code: string;
  round_no: number;
  status: "open" | "closed" | "waived";
  due_date: string | null;
  created_at: string;
  signoff_summary: {
    total: number;
    signed: number;
    pending: number;
    by_decision: Record<string, number>;
  };
  markup_summary: { open: number; resolved: number };
}

export interface ReviewSignoffRow {
  id: string;
  round_id: string;
  reviewer_id: string;
  reviewer_name: string;
  reviewer_email: string | null;
  reviewer_org: ReviewerOrg;
  decision:
    | "approved"
    | "approved_with_comments"
    | "rejected"
    | "waived"
    | null;
  comment: string | null;
  signed_at: string | null;
  created_at: string;
}

export interface ReviewRoundDetail extends ReviewRoundRow {
  signoffs: ReviewSignoffRow[];
}

export interface EligibleReviewer {
  user_id: string;
  full_name: string;
  email: string | null;
  roles: string[];
  suggested_org: ReviewerOrg;
}

// ---------------------------------------------------------------------------
// listReviewRounds
// ---------------------------------------------------------------------------
const projectIdInput = z.object({ projectId: z.string().uuid() });

export const listReviewRounds = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<ReviewRoundRow[]> => {
    requireSupabaseAuth(context);
    const { data: rounds, error } = await context.supabase
      .from("drawing_review_rounds")
      .select(
        "id, project_id, revision_id, round_no, status, due_date, created_at, drawing_revisions!inner (id, revision_code, drawing_id, drawing_register!inner (drawing_number, title))",
      )
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const list = (rounds ?? []) as any[];
    if (list.length === 0) return [];

    const roundIds = list.map((r) => r.id);
    const revIds = list.map((r) => r.revision_id);

    const [signoffsRes, markupsRes] = await Promise.all([
      context.supabase
        .from("drawing_review_signoffs")
        .select("round_id, decision")
        .in("round_id", roundIds),
      context.supabase
        .from("document_markups")
        .select("revision_id, status")
        .in("revision_id", revIds),
    ]);
    if (signoffsRes.error) throw signoffsRes.error;
    if (markupsRes.error) throw markupsRes.error;

    const signoffsByRound = new Map<string, any[]>();
    for (const s of (signoffsRes.data ?? []) as any[]) {
      const arr = signoffsByRound.get(s.round_id) ?? [];
      arr.push(s);
      signoffsByRound.set(s.round_id, arr);
    }
    const markupsByRev = new Map<string, any[]>();
    for (const m of (markupsRes.data ?? []) as any[]) {
      const arr = markupsByRev.get(m.revision_id) ?? [];
      arr.push(m);
      markupsByRev.set(m.revision_id, arr);
    }

    return list.map((r): ReviewRoundRow => {
      const so = signoffsByRound.get(r.id) ?? [];
      const total = so.length;
      const signed = so.filter((x) => x.decision != null).length;
      const byDecision: Record<string, number> = {};
      for (const x of so) {
        const key = x.decision ?? "pending";
        byDecision[key] = (byDecision[key] ?? 0) + 1;
      }
      const mk = markupsByRev.get(r.revision_id) ?? [];
      const rev = r.drawing_revisions;
      const draw = rev?.drawing_register;
      return {
        id: r.id,
        project_id: r.project_id,
        revision_id: r.revision_id,
        drawing_id: rev?.drawing_id ?? "",
        drawing_number: draw?.drawing_number ?? "",
        drawing_title: draw?.title ?? "",
        revision_code: rev?.revision_code ?? "",
        round_no: r.round_no,
        status: r.status,
        due_date: r.due_date,
        created_at: r.created_at,
        signoff_summary: {
          total,
          signed,
          pending: total - signed,
          by_decision: byDecision,
        },
        markup_summary: {
          open: mk.filter((x) => x.status === "open" || x.status === "rejected")
            .length,
          resolved: mk.filter(
            (x) => x.status === "resolved" || x.status === "accepted",
          ).length,
        },
      };
    });
  });

// ---------------------------------------------------------------------------
// getReviewRound
// ---------------------------------------------------------------------------
const roundIdInput = z.object({ roundId: z.string().uuid() });

export const getReviewRound = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => roundIdInput.parse(input))
  .handler(async ({ data, context }): Promise<ReviewRoundDetail> => {
    requireSupabaseAuth(context);
    const round = await loadRoundWithContext(context, data.roundId);
    const rev = await loadRevision(context, round.revision_id);

    const { data: signoffs, error } = await context.supabase
      .from("drawing_review_signoffs")
      .select(
        "id, round_id, reviewer_id, reviewer_org, decision, comment, signed_at, created_at, profiles:profiles!drawing_review_signoffs_reviewer_id_fkey (id, full_name, email)",
      )
      .eq("round_id", round.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const { data: markups } = await context.supabase
      .from("document_markups")
      .select("status")
      .eq("revision_id", round.revision_id);

    const so = ((signoffs ?? []) as any[]).map((s): ReviewSignoffRow => ({
      id: s.id,
      round_id: s.round_id,
      reviewer_id: s.reviewer_id,
      reviewer_name: s.profiles?.full_name ?? s.profiles?.email ?? "Reviewer",
      reviewer_email: s.profiles?.email ?? null,
      reviewer_org: s.reviewer_org,
      decision: s.decision,
      comment: s.comment,
      signed_at: s.signed_at,
      created_at: s.created_at,
    }));

    const byDecision: Record<string, number> = {};
    for (const x of so) {
      const key = x.decision ?? "pending";
      byDecision[key] = (byDecision[key] ?? 0) + 1;
    }
    const mk = (markups ?? []) as any[];

    return {
      id: round.id,
      project_id: round.project_id,
      revision_id: round.revision_id,
      drawing_id: rev.drawing_id,
      drawing_number: rev.drawing_number,
      drawing_title: rev.drawing_title,
      revision_code: rev.revision_code,
      round_no: round.round_no,
      status: round.status,
      due_date: round.due_date,
      created_at: round.created_at,
      signoff_summary: {
        total: so.length,
        signed: so.filter((s) => s.decision != null).length,
        pending: so.filter((s) => s.decision == null).length,
        by_decision: byDecision,
      },
      markup_summary: {
        open: mk.filter((x) => x.status === "open" || x.status === "rejected")
          .length,
        resolved: mk.filter(
          (x) => x.status === "resolved" || x.status === "accepted",
        ).length,
      },
      signoffs: so,
    };
  });

// ---------------------------------------------------------------------------
// listEligibleReviewers
// ---------------------------------------------------------------------------
export const listEligibleReviewers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<EligibleReviewer[]> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);

    const { data: roles, error } = await context.supabase
      .from("user_roles")
      .select("user_id, role, profiles:profiles!user_roles_user_id_fkey (id, full_name, email)")
      .eq("company_id", project.company_id)
      .in("role", ELIGIBLE_REVIEWER_ROLES as any);
    if (error) throw error;

    const byUser = new Map<string, EligibleReviewer>();
    for (const r of (roles ?? []) as any[]) {
      const uid = r.user_id as string;
      const existing = byUser.get(uid);
      if (existing) {
        if (!existing.roles.includes(r.role)) existing.roles.push(r.role);
      } else {
        byUser.set(uid, {
          user_id: uid,
          full_name:
            r.profiles?.full_name ?? r.profiles?.email ?? "Team member",
          email: r.profiles?.email ?? null,
          roles: [r.role],
          suggested_org: guessOrg(r.role),
        });
      }
    }
    return Array.from(byUser.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    );
  });

function guessOrg(role: string): ReviewerOrg {
  if (role === "client_viewer") return "client";
  if (role === "lender_viewer") return "lender";
  return "internal";
}

// ---------------------------------------------------------------------------
// startReviewRound
// ---------------------------------------------------------------------------
const startRoundInput = z.object({
  revisionId: z.string().uuid(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  reviewers: z
    .array(
      z.object({
        userId: z.string().uuid(),
        org: z.enum(REVIEWER_ORGS),
      }),
    )
    .min(1)
    .max(20),
});

export const startReviewRound = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => startRoundInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const rev = await loadRevision(context, data.revisionId);
    await assertRole(context, rev.company_id, ROUND_ADMIN_ROLES);

    if (rev.status !== "IFD") {
      httpError(
        409,
        "revision_not_ifd",
        "Review rounds can only be opened on an IFD revision.",
      );
    }

    // Deduplicate reviewers by userId.
    const uniq = new Map<string, ReviewerOrg>();
    for (const r of data.reviewers) uniq.set(r.userId, r.org);

    // Close any existing open round on this revision (superseded).
    const { data: openRounds, error: orErr } = await context.supabase
      .from("drawing_review_rounds")
      .select("id, round_no")
      .eq("revision_id", rev.id)
      .eq("status", "open");
    if (orErr) throw orErr;
    for (const r of (openRounds ?? []) as any[]) {
      await context.supabase
        .from("drawing_review_rounds")
        .update({ status: "closed" } as any)
        .eq("id", r.id);
    }

    // round_no = max + 1
    const { data: maxRow, error: mErr } = await context.supabase
      .from("drawing_review_rounds")
      .select("round_no")
      .eq("revision_id", rev.id)
      .order("round_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mErr) throw mErr;
    const nextRoundNo = ((maxRow as any)?.round_no ?? 0) + 1;

    const { data: inserted, error: iErr } = await context.supabase
      .from("drawing_review_rounds")
      .insert({
        company_id: rev.company_id,
        project_id: rev.project_id,
        revision_id: rev.id,
        round_no: nextRoundNo,
        status: "open",
        due_date: data.dueDate ?? null,
        created_by: context.user.id,
      } as any)
      .select("id")
      .single();
    if (iErr) throw iErr;
    const roundId = (inserted as any).id as string;

    const signoffRows = Array.from(uniq.entries()).map(([userId, org]) => ({
      company_id: rev.company_id,
      round_id: roundId,
      reviewer_id: userId,
      reviewer_org: org,
      decision: null,
      comment: null,
      signed_at: null,
    }));
    const { error: sErr } = await context.supabase
      .from("drawing_review_signoffs")
      .insert(signoffRows as any);
    if (sErr) throw sErr;

    // Notifications
    const notifRows = Array.from(uniq.keys()).map((userId) => ({
      company_id: rev.company_id,
      user_id: userId,
      type: "drawing_review.requested",
      title: `Review requested: ${rev.drawing_number} rev ${rev.revision_code}`,
      body: `You have been added as a reviewer${data.dueDate ? ` (due ${data.dueDate})` : ""}.`,
      link: `/projects/${rev.project_id}/engineering/drawings/${rev.drawing_id}`,
    }));
    await context.supabase.from("notifications").insert(notifRows as any);

    await audit(context, "engineering.review_round_started", "drawing_review_rounds", roundId, {
      revision_id: rev.id,
      drawing_id: rev.drawing_id,
      round_no: nextRoundNo,
      reviewer_count: uniq.size,
      due_date: data.dueDate ?? null,
    });

    return { ok: true, roundId, roundNo: nextRoundNo };
  });

// ---------------------------------------------------------------------------
// submitSignoff (reviewer only)
// ---------------------------------------------------------------------------
const submitInput = z.object({
  signoffId: z.string().uuid(),
  decision: z.enum(REVIEW_DECISIONS),
  comment: z.string().trim().max(2000).optional().nullable(),
});

export const submitSignoff = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => submitInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: so, error } = await context.supabase
      .from("drawing_review_signoffs")
      .select("id, company_id, round_id, reviewer_id, decision")
      .eq("id", data.signoffId)
      .maybeSingle();
    if (error) throw error;
    if (!so) httpError(404, "signoff_not_found");
    const row = so as any;
    if (row.reviewer_id !== context.user.id) {
      httpError(403, "forbidden_not_reviewer", "Only the named reviewer can sign this row.");
    }
    if (row.decision != null) {
      httpError(409, "already_signed", "This sign-off has already been recorded.");
    }
    if (data.decision === "approved_with_comments" || data.decision === "rejected") {
      if (!data.comment || data.comment.trim().length === 0) {
        httpError(409, "comment_required", "A comment is required for this decision.");
      }
    }

    const now = new Date().toISOString();
    const { error: uErr } = await context.supabase
      .from("drawing_review_signoffs")
      .update({
        decision: data.decision,
        comment: data.comment ?? null,
        signed_at: now,
      } as any)
      .eq("id", row.id);
    if (uErr) throw uErr;

    await audit(context, "engineering.review_signoff", "drawing_review_signoffs", row.id, {
      round_id: row.round_id,
      decision: data.decision,
    });

    await maybeAutoClose(context, row.round_id);

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// waiveSignoff (engineering_admin only, comment required)
// ---------------------------------------------------------------------------
const waiveInput = z.object({
  signoffId: z.string().uuid(),
  comment: z.string().trim().min(1, "comment required").max(2000),
});

export const waiveSignoff = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => waiveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!data.comment || data.comment.trim().length === 0) {
      httpError(409, "comment_required", "A waiver requires a comment.");
    }
    const { data: so, error } = await context.supabase
      .from("drawing_review_signoffs")
      .select("id, company_id, round_id, reviewer_id, decision")
      .eq("id", data.signoffId)
      .maybeSingle();
    if (error) throw error;
    if (!so) httpError(404, "signoff_not_found");
    const row = so as any;
    await assertRole(context, row.company_id, WAIVE_ROLES);
    if (row.decision != null) {
      httpError(409, "already_signed", "This sign-off has already been recorded.");
    }

    const now = new Date().toISOString();
    const { error: uErr } = await context.supabase
      .from("drawing_review_signoffs")
      .update({
        decision: "waived",
        comment: data.comment.trim(),
        signed_at: now,
      } as any)
      .eq("id", row.id);
    if (uErr) throw uErr;

    await audit(context, "engineering.review_waived", "drawing_review_signoffs", row.id, {
      round_id: row.round_id,
      reviewer_id: row.reviewer_id,
    });

    await maybeAutoClose(context, row.round_id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// closeReviewRound (manual)
// ---------------------------------------------------------------------------
export const closeReviewRound = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => roundIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const round = await loadRoundWithContext(context, data.roundId);
    await assertRole(context, round.company_id, ROUND_ADMIN_ROLES);

    const { data: sos } = await context.supabase
      .from("drawing_review_signoffs")
      .select("id, decision")
      .eq("round_id", round.id);
    const arr = (sos ?? []) as any[];
    if (arr.length === 0) httpError(409, "no_signoffs");
    if (arr.some((s) => s.decision == null)) {
      httpError(409, "signoffs_pending", "Cannot close — some reviewers have not signed.");
    }

    const { error: uErr } = await context.supabase
      .from("drawing_review_rounds")
      .update({ status: "closed" } as any)
      .eq("id", round.id);
    if (uErr) throw uErr;
    await audit(context, "engineering.review_closed", "drawing_review_rounds", round.id, {});
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Auto-close helper
// ---------------------------------------------------------------------------
async function maybeAutoClose(context: any, roundId: string) {
  const { data: sos } = await context.supabase
    .from("drawing_review_signoffs")
    .select("decision")
    .eq("round_id", roundId);
  const arr = (sos ?? []) as any[];
  if (arr.length === 0) return;
  if (arr.some((s) => s.decision == null)) return;
  await context.supabase
    .from("drawing_review_rounds")
    .update({ status: "closed" } as any)
    .eq("id", roundId)
    .eq("status", "open");
}

// ---------------------------------------------------------------------------
// getMyReviewRoles — small helper the UI uses for gating
// ---------------------------------------------------------------------------
export const getMyReviewRoles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("company_id", project.company_id)
      .eq("user_id", context.user.id);
    const list = ((roles ?? []) as any[]).map((r) => r.role as string);
    return {
      canStartRound:
        list.includes("engineering_admin") ||
        list.includes("project_admin") ||
        list.includes("super_admin"),
      canWaive:
        list.includes("engineering_admin") || list.includes("super_admin"),
      canClose:
        list.includes("engineering_admin") ||
        list.includes("project_admin") ||
        list.includes("super_admin"),
      userId: context.user.id,
    };
  });
