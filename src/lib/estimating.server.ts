// P-210 — Estimating I/O helpers. Kept out of *.functions.ts so the
// server-fn splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasAnyRole, httpError } from "@/lib/payments.server";
import { computeEstimate, type MarginInput } from "@/lib/estimating/buildup";
import { proposalLinesFromEstimate, sumLineTotals } from "@/lib/estimating/convert";
import {
  actualsByType,
  meanAbsoluteVariance,
  variancePct,
  type PoForComparison,
  type PoLineLike,
} from "@/lib/estimating/comparison";
import {
  sortRevisionsDesc,
  type RevisionLine,
  type RevisionSummary,
} from "@/lib/estimating/revision-diff";
import {
  ESTIMATE_APPROVAL_ENTITY,
  ESTIMATE_APPROVAL_RULE_KEY,
  ESTIMATE_WRITE_ROLES,
  RATE_WRITE_ROLES,
  bomLinesToEstimateLines,
  isEstimateEditable,
  type BomLineForImport,
  type EstimateStatus,
} from "@/lib/estimating.rules";

export interface EstimateRow {
  id: string;
  estimate_number: string | null;
  title: string;
  project_id: string;
  opportunity_id: string | null;
  bom_snapshot_id: string | null;
  revision: number;
  status: EstimateStatus;
  currency_code: string;
  direct_cost: number;
  escalation_pct: number;
  contingency_pct: number;
  overhead_pct: number;
  profit_pct: number;
  subtotal: number;
  total_price: number;
  priced_at: string | null;
  updated_at: string;
}

export interface EstimateLineRow {
  id: string;
  estimate_id: string;
  line_type: string;
  description: string;
  qty: number;
  uom: string;
  unit_rate: number;
  amount: number;
  rate_library_id: string | null;
  source_bom_line_id: string | null;
  sort_order: number;
  notes: string | null;
}

export interface RateRowRecord {
  id: string;
  rate_type: string;
  name: string;
  uom: string;
  unit_rate: number;
  currency_code: string;
  category: string | null;
  supplier: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
}

const ESTIMATE_COLUMNS =
  "id, estimate_number, title, project_id, opportunity_id, bom_snapshot_id, revision, status, currency_code, direct_cost, escalation_pct, contingency_pct, overhead_pct, profit_pct, subtotal, total_price, priced_at, updated_at";
const LINE_COLUMNS =
  "id, estimate_id, line_type, description, qty, uom, unit_rate, amount, rate_library_id, source_bom_line_id, sort_order, notes";
const RATE_COLUMNS =
  "id, rate_type, name, uom, unit_rate, currency_code, category, supplier, valid_from, valid_to, notes";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function estimatingCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id ?? null;
  if (!companyId) httpError(400, "no_company", "No active company context.");
  return companyId as string;
}

export async function canWriteEstimates(ctx: AuthContext): Promise<boolean> {
  return hasAnyRole(ctx, ESTIMATE_WRITE_ROLES);
}

export async function canWriteRates(ctx: AuthContext): Promise<boolean> {
  return hasAnyRole(ctx, RATE_WRITE_ROLES);
}

export async function assertEstimateWrite(ctx: AuthContext): Promise<void> {
  if (!(await canWriteEstimates(ctx))) {
    httpError(
      403,
      "forbidden",
      "Only engineering, procurement or company admins can edit estimates.",
    );
  }
}

export async function assertRateWrite(ctx: AuthContext): Promise<void> {
  if (!(await canWriteRates(ctx))) {
    httpError(403, "forbidden", "You do not have permission to edit the rate library.");
  }
}

/* ------------------------------------------------------------------ reads */

export async function loadEstimates(
  ctx: AuthContext,
  filters: { status?: string | null; project_id?: string | null; q?: string | null },
): Promise<EstimateRow[]> {
  let query = ctx.supabase
    .from("estimates")
    .select(ESTIMATE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (filters.status) query = query.eq("status", filters.status as never);
  if (filters.project_id) query = query.eq("project_id", filters.project_id);
  const q = (filters.q ?? "").trim().replace(/[%,()]/g, "");
  if (q) query = query.or(`estimate_number.ilike.%${q}%,title.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as EstimateRow[];
}

export async function loadEstimate(ctx: AuthContext, id: string): Promise<EstimateRow> {
  const { data, error } = await ctx.supabase
    .from("estimates")
    .select(ESTIMATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Estimate not found.");
  return data as unknown as EstimateRow;
}

export async function loadLines(ctx: AuthContext, estimateId: string): Promise<EstimateLineRow[]> {
  const { data, error } = await ctx.supabase
    .from("estimate_lines")
    .select(LINE_COLUMNS)
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as EstimateLineRow[];
}

export async function loadRates(
  ctx: AuthContext,
  opts: { q?: string | null; rate_type?: string | null } = {},
): Promise<RateRowRecord[]> {
  let query = ctx.supabase
    .from("rate_library")
    .select(RATE_COLUMNS)
    .order("rate_type", { ascending: true })
    .order("name", { ascending: true })
    .limit(500);
  if (opts.rate_type) query = query.eq("rate_type", opts.rate_type as never);
  const q = (opts.q ?? "").trim().replace(/[%,()]/g, "");
  if (q) query = query.or(`name.ilike.%${q}%,supplier.ilike.%${q}%,category.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as RateRowRecord[];
}

export interface ProjectOption {
  id: string;
  name: string;
  code: string | null;
}
export interface OpportunityOption {
  id: string;
  name: string;
}
export interface SnapshotOption {
  id: string;
  project_id: string;
  version: number;
  status: string;
  created_at: string;
}

export async function loadProjectOptions(ctx: AuthContext): Promise<ProjectOption[]> {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("id, name, code")
    .order("name", { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as ProjectOption[];
}

export async function loadOpportunityOptions(ctx: AuthContext): Promise<OpportunityOption[]> {
  const { data, error } = await ctx.supabase
    .from("opportunities")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(300);
  if (error) return [];
  return (data ?? []) as unknown as OpportunityOption[];
}

export async function loadSnapshotOptions(ctx: AuthContext): Promise<SnapshotOption[]> {
  const { data, error } = await ctx.supabase
    .from("bom_snapshots")
    .select("id, project_id, version, status, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return [];
  return (data ?? []) as unknown as SnapshotOption[];
}

/* ----------------------------------------------------------------- writes */

/** Load the estimate and refuse edits unless it is still a draft. */
export async function assertDraft(ctx: AuthContext, estimateId: string): Promise<EstimateRow> {
  const estimate = await loadEstimate(ctx, estimateId);
  if (!isEstimateEditable(estimate.status)) {
    httpError(409, "estimate_locked", `Estimate ${estimate.estimate_number ?? ""} is not a draft.`);
  }
  return estimate;
}

/**
 * Recompute and persist the money columns after a line change: direct_cost =
 * Σ lines.amount, plus the staged build-up at the estimate's current margins.
 */
export async function recomputeDirectCost(ctx: AuthContext, estimateId: string): Promise<number> {
  const estimate = await loadEstimate(ctx, estimateId);
  const { result } = await persistBuildup(ctx, estimateId, marginsOf(estimate));
  return result.direct_cost;
}

/** Copy a BOM snapshot's lines into a fresh estimate. Returns lines imported. */
export async function importBomSnapshot(
  ctx: AuthContext,
  args: { companyId: string; estimateId: string; snapshotId: string },
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from("bom_lines")
    .select("id, item, spec, qty_buffered, unit, unit_cost")
    .eq("snapshot_id", args.snapshotId)
    .order("category", { ascending: true })
    .order("item", { ascending: true });
  if (error) throw error;
  const source = (data ?? []) as unknown as BomLineForImport[];
  if (source.length === 0) return 0;
  const payload = bomLinesToEstimateLines(source).map((l) => ({
    ...l,
    company_id: args.companyId,
    estimate_id: args.estimateId,
  }));
  const { error: insErr } = await ctx.supabase.from("estimate_lines").insert(payload as never);
  if (insErr) throw insErr;
  return payload.length;
}

/* ------------------------------------------------------- build-up (P-211) */

export function marginsOf(estimate: EstimateRow): MarginInput {
  return {
    escalation_pct: Number(estimate.escalation_pct) || 0,
    contingency_pct: Number(estimate.contingency_pct) || 0,
    overhead_pct: Number(estimate.overhead_pct) || 0,
    profit_pct: Number(estimate.profit_pct) || 0,
  };
}

/**
 * Recompute the whole build-up server-side from persisted lines — client
 * totals are never trusted — and persist the derived money columns.
 */
export async function persistBuildup(
  ctx: AuthContext,
  estimateId: string,
  margins: MarginInput,
  extra: Record<string, unknown> = {},
) {
  const lines = await loadLines(ctx, estimateId);
  const result = computeEstimate(lines, margins);
  const { error } = await ctx.supabase
    .from("estimates")
    .update({
      escalation_pct: margins.escalation_pct,
      contingency_pct: margins.contingency_pct,
      overhead_pct: margins.overhead_pct,
      profit_pct: margins.profit_pct,
      direct_cost: result.direct_cost,
      subtotal: result.subtotal,
      total_price: result.total_price,
      ...extra,
    } as never)
    .eq("id", estimateId);
  if (error) throw error;
  return { result, lines };
}

/* --------------------------------------------- approval + convert (P-212) */

export interface EstimateApprovalSnapshot {
  id: string;
  status: string;
  current_step: number;
  sla_due_at: string | null;
  requested_at: string | null;
}

/** Latest approval instance for an estimate, or null when never submitted. */
export async function loadEstimateApproval(
  ctx: AuthContext,
  estimateId: string,
): Promise<EstimateApprovalSnapshot | null> {
  const { data, error } = await ctx.supabase
    .from("approval_instances")
    .select("id, status, current_step, sla_due_at, requested_at")
    .eq("entity_type", ESTIMATE_APPROVAL_ENTITY)
    .eq("entity_id", estimateId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as
    | {
        id: string;
        status: string;
        current_step: number | null;
        sla_due_at: string | null;
        requested_at: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step ?? 1,
    sla_due_at: row.sla_due_at,
    requested_at: row.requested_at,
  };
}

/** Opens the engineering_admin → finance_admin chain via the P-111 engine. */
export async function startEstimateApproval(
  ctx: AuthContext,
  estimate: EstimateRow,
): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc("start_approval_instance", {
    p_rule_key: ESTIMATE_APPROVAL_RULE_KEY,
    p_entity_type: ESTIMATE_APPROVAL_ENTITY,
    p_entity_id: estimate.id,
    p_amount: estimate.total_price as never,
    p_metadata: {
      estimate_number: estimate.estimate_number,
      project_id: estimate.project_id,
    } as never,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Latest decision comment on the instance, for surfacing a rejection. */
export async function loadDecisionComment(
  ctx: AuthContext,
  instanceId: string,
): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("approvals")
    .select("comment, decided_at")
    .eq("instance_id", instanceId)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { comment: string | null } | undefined;
  return row?.comment ?? null;
}

/** Patch arbitrary workflow columns on an estimate (columns added by 0086). */
export async function patchEstimate(
  ctx: AuthContext,
  estimateId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("estimates")
    .update(patch as never)
    .eq("id", estimateId);
  if (error) throw error;
}

export interface EstimateConversionState {
  approval_instance_id: string | null;
  converted_proposal_id: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejection_comment: string | null;
}

export async function loadConversionState(
  ctx: AuthContext,
  estimateId: string,
): Promise<EstimateConversionState> {
  const { data, error } = await ctx.supabase
    .from("estimates")
    .select(
      "approval_instance_id, converted_proposal_id, submitted_at, approved_at, rejection_comment",
    )
    .eq("id", estimateId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? null) as unknown as EstimateConversionState | null;
  return (
    row ?? {
      approval_instance_id: null,
      converted_proposal_id: null,
      submitted_at: null,
      approved_at: null,
      rejection_comment: null,
    }
  );
}

/**
 * Create the draft proposal + line items from an approved estimate. Returns
 * the new proposal id. Totals are recomputed server-side from the lines.
 */
export async function createProposalFromEstimate(
  ctx: AuthContext,
  args: {
    companyId: string;
    estimate: EstimateRow;
    opportunityId: string;
    lines: EstimateLineRow[];
  },
): Promise<{ proposalId: string; lineCount: number }> {
  const { estimate } = args;
  const buildup = computeEstimate(args.lines, marginsOf(estimate));
  const drafts = proposalLinesFromEstimate(args.lines, buildup);
  if (Math.abs(sumLineTotals(drafts) - buildup.subtotal) > 0.01) {
    httpError(409, "conversion_unbalanced", "Generated proposal lines do not reconcile.");
  }

  const { data: created, error } = await ctx.supabase
    .from("proposals")
    .insert({
      company_id: args.companyId,
      opportunity_id: args.opportunityId,
      project_id: estimate.project_id,
      title: estimate.title,
      version: 1,
      status: "draft",
      currency_code: estimate.currency_code,
      subtotal: buildup.subtotal,
      margin_pct: Number(estimate.profit_pct) || 0,
      contingency_pct: Number(estimate.contingency_pct) || 0,
      total: buildup.total_price,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const proposalId = (created as { id: string }).id;

  if (drafts.length > 0) {
    const { error: lineErr } = await ctx.supabase.from("proposal_line_items").insert(
      drafts.map((d) => ({
        company_id: args.companyId,
        proposal_id: proposalId,
        sort_order: d.sort_order,
        category: d.category,
        description: d.description,
        qty: d.qty,
        unit: d.unit,
        unit_price: d.unit_price,
        line_total: d.line_total,
      })) as never,
    );
    if (lineErr) throw lineErr;
  }
  return { proposalId, lineCount: drafts.length };
}

/**
 * Best-effort digital-thread link. Missing table (0077) or a CHECK violation
 * is logged and swallowed — a link must never block the conversion.
 */
export async function linkEstimateToProposal(
  ctx: AuthContext,
  args: { companyId: string; projectId: string | null; estimateId: string; proposalId: string },
): Promise<void> {
  try {
    const { error } = await ctx.supabase.from("entity_links").insert({
      company_id: args.companyId,
      project_id: args.projectId,
      source_type: "estimate",
      source_id: args.estimateId,
      link_type: "derives",
      target_type: "proposal",
      target_id: args.proposalId,
    } as never);
    if (error) console.warn("[estimating] entity_link skipped:", error.message);
  } catch (err) {
    console.warn("[estimating] entity_link skipped:", err);
  }
}

/* ------------------------------------------- comparison + revisions (P-213) */

/**
 * Run a source query and degrade to `null` when the object is missing
 * (42P01 / PostgREST schema-cache miss) so one absent table never fails the
 * whole comparison.
 */
export async function guardedSource<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const code = e?.code ?? "";
    const msg = (e?.message ?? "").toLowerCase();
    if (
      code === "42P01" ||
      code === "PGRST205" ||
      code === "PGRST200" ||
      msg.includes("does not exist") ||
      msg.includes("schema cache")
    ) {
      console.warn("[estimating] comparison source unavailable:", e?.message ?? code);
      return null;
    }
    throw err;
  }
}

/** Non-draft, non-cancelled POs on the project with their jsonb lines. */
export async function loadProjectPos(
  ctx: AuthContext,
  projectId: string,
): Promise<PoForComparison[] | null> {
  return guardedSource(async () => {
    const { data, error } = await ctx.supabase
      .from("purchase_orders")
      .select("id, status, total_amount, lines")
      .eq("project_id", projectId)
      .not("status", "in", "(draft,cancelled)")
      .limit(1000);
    if (error) throw error;
    return ((data ?? []) as unknown as PoRecord[]).map((po) => ({
      id: po.id,
      total: Number(po.total_amount ?? 0),
      lines: Array.isArray(po.lines) ? (po.lines as PoLineLike[]) : [],
    }));
  });
}

interface PoRecord {
  id: string;
  status: string;
  total_amount: number | string | null;
  lines: unknown;
}

/** Matched/approved invoice amounts keyed by PO id. */
export async function loadInvoicedByPo(
  ctx: AuthContext,
  poIds: readonly string[],
): Promise<Record<string, number> | null> {
  if (poIds.length === 0) return {};
  return guardedSource(async () => {
    const { data, error } = await ctx.supabase
      .from("three_way_matches")
      .select("po_id, invoice_amount, status")
      .in("po_id", poIds as string[])
      .in("status", ["matched", "approved_with_variance"])
      .limit(2000);
    if (error) throw error;
    const out: Record<string, number> = {};
    for (const row of (data ?? []) as unknown as Array<{
      po_id: string;
      invoice_amount: number | string | null;
    }>) {
      out[row.po_id] = (out[row.po_id] ?? 0) + Number(row.invoice_amount ?? 0);
    }
    return out;
  });
}

/** Σ labour hours × rate on completed work orders for the project. */
export async function loadLaborActuals(
  ctx: AuthContext,
  projectId: string,
): Promise<number | null> {
  return guardedSource(async () => {
    const { data, error } = await ctx.supabase
      .from("work_orders")
      .select("id, labor, status")
      .eq("project_id", projectId)
      .in("status", ["completed", "closed"])
      .limit(2000);
    if (error) throw error;
    let total = 0;
    for (const row of (data ?? []) as unknown as Array<{ labor: unknown }>) {
      const labor = Array.isArray(row.labor) ? row.labor : [];
      for (const l of labor as Array<{ hours?: number | string; rate?: number | string }>) {
        total += (Number(l?.hours ?? 0) || 0) * (Number(l?.rate ?? 0) || 0);
      }
    }
    return Math.round(total * 100) / 100;
  });
}

const REVISION_COLUMNS = `${ESTIMATE_COLUMNS}, supersedes_id, submitted_at, created_by`;

/** Walk the supersedes_id chain backwards and forwards from one estimate. */
export async function loadRevisionChain(
  ctx: AuthContext,
  estimateId: string,
): Promise<{ summaries: RevisionSummary[]; lines: Record<string, RevisionLine[]> }> {
  const seen = new Map<string, Record<string, unknown>>();

  const fetchById = async (id: string) => {
    const { data, error } = await ctx.supabase
      .from("estimates")
      .select(REVISION_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Record<string, unknown> | null;
  };
  const fetchSuccessor = async (id: string) => {
    const { data, error } = await ctx.supabase
      .from("estimates")
      .select(REVISION_COLUMNS)
      .eq("supersedes_id", id)
      .limit(1);
    if (error) throw error;
    return ((data ?? [])[0] ?? null) as Record<string, unknown> | null;
  };

  let cursor: Record<string, unknown> | null = await fetchById(estimateId);
  while (cursor && !seen.has(cursor.id as string) && seen.size < 40) {
    seen.set(cursor.id as string, cursor);
    const prev = cursor.supersedes_id as string | null;
    cursor = prev ? await fetchById(prev) : null;
  }
  let forward: Record<string, unknown> | null = await fetchSuccessor(estimateId);
  while (forward && !seen.has(forward.id as string) && seen.size < 40) {
    seen.set(forward.id as string, forward);
    forward = await fetchSuccessor(forward.id as string);
  }

  const ids = [...seen.keys()];
  const actors = await loadActorNames(
    ctx,
    [...seen.values()].map((r) => (r.created_by as string | null) ?? null),
  );

  const summaries: RevisionSummary[] = [...seen.values()].map((r) => ({
    id: r.id as string,
    estimate_number: (r.estimate_number as string | null) ?? null,
    revision: Number(r.revision ?? 1),
    status: String(r.status ?? "draft"),
    currency_code: String(r.currency_code ?? "USD"),
    direct_cost: Number(r.direct_cost ?? 0),
    subtotal: Number(r.subtotal ?? 0),
    total_price: Number(r.total_price ?? 0),
    escalation_pct: Number(r.escalation_pct ?? 0),
    contingency_pct: Number(r.contingency_pct ?? 0),
    overhead_pct: Number(r.overhead_pct ?? 0),
    profit_pct: Number(r.profit_pct ?? 0),
    priced_at: (r.priced_at as string | null) ?? null,
    submitted_at: (r.submitted_at as string | null) ?? null,
    supersedes_id: (r.supersedes_id as string | null) ?? null,
    actor: actors[(r.created_by as string | null) ?? ""] ?? null,
  }));

  const lines: Record<string, RevisionLine[]> = {};
  for (const id of ids) {
    lines[id] = (await loadLines(ctx, id)).map((l) => ({
      id: l.id,
      line_type: l.line_type,
      description: l.description,
      qty: Number(l.qty),
      uom: l.uom,
      unit_rate: Number(l.unit_rate),
      amount: Number(l.amount),
      source_bom_line_id: l.source_bom_line_id,
    }));
  }
  return { summaries: sortRevisionsDesc(summaries), lines };
}

async function loadActorNames(
  ctx: AuthContext,
  ids: readonly (string | null)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return {};
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as unknown as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    out[p.id] = p.full_name ?? p.email ?? "—";
  }
  return out;
}

/**
 * Copy header + all lines into a fresh draft at revision + 1 and mark the
 * source estimate superseded. Returns the new estimate id.
 */
export async function cloneEstimateAsRevision(
  ctx: AuthContext,
  args: { companyId: string; estimate: EstimateRow },
): Promise<{ id: string; revision: number; lines_copied: number }> {
  const { estimate } = args;
  const revision = Number(estimate.revision ?? 1) + 1;

  const { data: created, error } = await ctx.supabase
    .from("estimates")
    .insert({
      company_id: args.companyId,
      project_id: estimate.project_id,
      opportunity_id: estimate.opportunity_id,
      bom_snapshot_id: estimate.bom_snapshot_id,
      title: estimate.title,
      currency_code: estimate.currency_code,
      revision,
      supersedes_id: estimate.id,
      status: "draft",
      escalation_pct: estimate.escalation_pct,
      contingency_pct: estimate.contingency_pct,
      overhead_pct: estimate.overhead_pct,
      profit_pct: estimate.profit_pct,
      direct_cost: estimate.direct_cost,
      subtotal: estimate.subtotal,
      total_price: estimate.total_price,
      approval_instance_id: null,
      submitted_at: null,
      submitted_by: null,
      approved_at: null,
      approved_by: null,
      priced_at: null,
      rejection_comment: null,
      converted_proposal_id: null,
      converted_at: null,
      converted_by: null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const newId = (created as { id: string }).id;

  const sourceLines = await loadLines(ctx, estimate.id);
  if (sourceLines.length > 0) {
    const { error: lineErr } = await ctx.supabase.from("estimate_lines").insert(
      sourceLines.map((l) => ({
        company_id: args.companyId,
        estimate_id: newId,
        line_type: l.line_type,
        description: l.description,
        qty: l.qty,
        uom: l.uom,
        unit_rate: l.unit_rate,
        amount: l.amount,
        rate_library_id: l.rate_library_id,
        source_bom_line_id: l.source_bom_line_id,
        sort_order: l.sort_order,
        notes: l.notes,
      })) as never,
    );
    if (lineErr) {
      // Roll the header back so a failed copy never leaves a half revision.
      await ctx.supabase.from("estimates").delete().eq("id", newId);
      throw lineErr;
    }
  }

  await patchEstimate(ctx, estimate.id, { status: "superseded" });
  return { id: newId, revision, lines_copied: sourceLines.length };
}

/**
 * Mean absolute variance of the project's priced estimates vs actuals.
 * Fully guarded: returns null when no priced estimate has actuals.
 */
export async function projectEstimateAccuracy(
  ctx: AuthContext,
  projectId: string,
): Promise<number | null> {
  try {
    const { data, error } = await ctx.supabase
      .from("estimates")
      .select("id, total_price, direct_cost, status")
      .eq("project_id", projectId)
      .eq("status", "priced")
      .limit(200);
    if (error) throw error;
    const priced = (data ?? []) as unknown as Array<{ id: string; direct_cost: number | string }>;
    if (priced.length === 0) return null;

    const pos = await loadProjectPos(ctx, projectId);
    if (!pos) return null;
    const invoiced = await loadInvoicedByPo(
      ctx,
      pos.map((p) => p.id),
    );
    const labor = await loadLaborActuals(ctx, projectId);
    if (invoiced == null && labor == null) return null;
    const actualRows = actualsByType(pos, invoiced ?? {}, labor ?? 0);
    const actualTotal = Object.values(actualRows).reduce((s, v) => s + v, 0);
    if (actualTotal <= 0) return null;

    return meanAbsoluteVariance(
      priced.map((e) => variancePct(Number(e.direct_cost ?? 0), actualTotal)),
    );
  } catch (err) {
    console.warn("[estimating] accuracy unavailable:", err);
    return null;
  }
}
