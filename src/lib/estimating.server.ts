// P-210 — Estimating I/O helpers. Kept out of *.functions.ts so the
// server-fn splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasAnyRole, httpError } from "@/lib/payments.server";
import {
  ESTIMATE_WRITE_ROLES,
  RATE_WRITE_ROLES,
  bomLinesToEstimateLines,
  isEstimateEditable,
  sumAmounts,
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
  total_price: number;
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
  "id, estimate_number, title, project_id, opportunity_id, bom_snapshot_id, revision, status, currency_code, direct_cost, total_price, updated_at";
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

/** Recompute and persist estimates.direct_cost = Σ lines.amount. */
export async function recomputeDirectCost(ctx: AuthContext, estimateId: string): Promise<number> {
  const lines = await loadLines(ctx, estimateId);
  const total = sumAmounts(lines);
  const { error } = await ctx.supabase
    .from("estimates")
    .update({ direct_cost: total })
    .eq("id", estimateId);
  if (error) throw error;
  return total;
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
