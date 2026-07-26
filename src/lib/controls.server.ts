// P-180 — Server-only helpers for planning & controls. Kept out of
// *.functions.ts so the server-fn split transform can't drop siblings.
import type { Client } from "@/lib/cwp.server";
import {
  compareToBaseline,
  criticalPathTaskIds,
  disciplineProgress,
  productivityRows,
  weightedProgressPct,
  type BaselineEntry,
  type BaselineVarianceRow,
  type ProductivityFact,
  type ProductivityRow,
  type QuantityFact,
  type WeightingRule,
} from "@/lib/controls.rules";

export interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

export async function loadProjectOptions(client: Client): Promise<ProjectOption[]> {
  const { data, error } = await client
    .from("projects")
    .select("id, name, code")
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectOption[];
}

// ---------------------------------------------------------------------------
// Critical path
// ---------------------------------------------------------------------------
export async function recomputeCriticalPathFor(
  client: Client,
  projectId: string,
): Promise<{ criticalIds: string[]; updated: number }> {
  const { data, error } = await client
    .from("schedule_tasks")
    .select("id, start_date, end_date, predecessor_ids, status, is_critical")
    .eq("project_id", projectId);
  if (error) throw error;
  const tasks = (data ?? []) as Array<{
    id: string;
    start_date: string;
    end_date: string;
    predecessor_ids: string[] | null;
    status: string;
    is_critical: boolean;
  }>;
  const criticalIds = criticalPathTaskIds(
    tasks.map((t) => ({ ...t, predecessor_ids: t.predecessor_ids ?? [] })),
  );
  const critical = new Set(criticalIds);
  const toTrue = tasks.filter((t) => critical.has(t.id) && !t.is_critical).map((t) => t.id);
  const toFalse = tasks.filter((t) => !critical.has(t.id) && t.is_critical).map((t) => t.id);
  if (toTrue.length) {
    const { error: e } = await client
      .from("schedule_tasks")
      .update({ is_critical: true } as never)
      .in("id", toTrue);
    if (e) throw e;
  }
  if (toFalse.length) {
    const { error: e } = await client
      .from("schedule_tasks")
      .update({ is_critical: false } as never)
      .in("id", toFalse);
    if (e) throw e;
  }
  return { criticalIds, updated: toTrue.length + toFalse.length };
}

// ---------------------------------------------------------------------------
// Baseline compare
// ---------------------------------------------------------------------------
export async function buildBaselineCompare(
  client: Client,
  projectId: string,
  baselineId: string,
): Promise<{ rows: BaselineVarianceRow[]; baselineName: string; locked: boolean }> {
  const { data: baseline, error: bErr } = await client
    .from("baseline_snapshots")
    .select("id, name, locked, snapshot")
    .eq("id", baselineId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!baseline) return { rows: [], baselineName: "", locked: false };

  const { data: tasks, error: tErr } = await client
    .from("schedule_tasks")
    .select("id, name, start_date, end_date, progress_pct")
    .eq("project_id", projectId);
  if (tErr) throw tErr;

  const entries = (
    Array.isArray((baseline as { snapshot: unknown }).snapshot)
      ? ((baseline as { snapshot: unknown }).snapshot as BaselineEntry[])
      : []
  ).map((e) => ({ ...e, progress_pct: Number(e.progress_pct ?? 0) }));

  return {
    rows: compareToBaseline(
      ((tasks ?? []) as Array<Record<string, unknown>>).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        start_date: t.start_date as string,
        end_date: t.end_date as string,
        progress_pct: Number(t.progress_pct ?? 0),
      })),
      entries,
    ),
    baselineName: (baseline as { name: string }).name,
    locked: Boolean((baseline as { locked: boolean }).locked),
  };
}

// ---------------------------------------------------------------------------
// Quantity → progress → EVM input
// ---------------------------------------------------------------------------
interface DprQuantity {
  discipline?: string | null;
  area?: string | null;
  uom?: string | null;
  quantity?: number | null;
}

export async function approvedQuantityFacts(
  client: Client,
  projectId: string,
  from?: string,
  to?: string,
): Promise<Array<DprQuantity & { report_date: string; dpr_id: string }>> {
  let q = client
    .from("construction_daily_reports")
    .select("id, report_date, quantities")
    .eq("project_id", projectId)
    .eq("status", "approved");
  if (from) q = q.gte("report_date", from);
  if (to) q = q.lte("report_date", to);
  const { data, error } = await q;
  if (error) throw error;
  const out: Array<DprQuantity & { report_date: string; dpr_id: string }> = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    report_date: string;
    quantities: unknown;
  }>) {
    const list = Array.isArray(row.quantities) ? (row.quantities as DprQuantity[]) : [];
    for (const q2 of list) {
      out.push({ ...q2, report_date: row.report_date, dpr_id: row.id });
    }
  }
  return out;
}

export interface QuantityProgressResult {
  disciplines: Array<{ discipline: string; progressPct: number; cwpCount: number }>;
  updatedCwps: number;
  projectProgressPct: number;
  /** EV feed for the existing P-076 evm_snapshots path — no new table. */
  evmInput: { projectProgressPct: number; source: "quantity_progress" };
}

export async function computeQuantityProgressFor(
  client: Client,
  projectId: string,
): Promise<QuantityProgressResult> {
  const facts = await approvedQuantityFacts(client, projectId);
  const { data: ruleRows, error: rErr } = await client
    .from("progress_weighting_rules")
    .select("id, project_id, discipline, uom, target_qty, is_active")
    .or(`project_id.eq.${projectId},project_id.is.null`);
  if (rErr) throw rErr;
  const rules = ((ruleRows ?? []) as WeightingRule[]).map((r) => ({
    ...r,
    target_qty: Number(r.target_qty ?? 0),
  }));

  const qFacts: QuantityFact[] = facts.map((f) => ({
    discipline: (f.discipline ?? "general") || "general",
    uom: (f.uom ?? "item") || "item",
    quantity: Number(f.quantity ?? 0),
  }));
  const byDiscipline = disciplineProgress(qFacts, rules);

  const { data: cwps, error: cErr } = await client
    .from("construction_work_packages")
    .select("id, discipline, weight, progress_pct, status")
    .eq("project_id", projectId);
  if (cErr) throw cErr;

  const packages = ((cwps ?? []) as Array<{
    id: string;
    discipline: string;
    weight: number | string;
    progress_pct: number | string;
    status: string;
  }>).map((c) => ({ ...c, weight: Number(c.weight ?? 0), progress_pct: Number(c.progress_pct ?? 0) }));

  let updated = 0;
  const next = packages.map((c) => {
    const pct = byDiscipline.get(c.discipline);
    return { ...c, next_pct: pct == null ? c.progress_pct : pct };
  });
  for (const c of next) {
    if (Math.abs(c.next_pct - c.progress_pct) < 0.005) continue;
    const { error } = await client
      .from("construction_work_packages")
      .update({ progress_pct: c.next_pct } as never)
      .eq("id", c.id);
    if (error) throw error;
    updated += 1;
  }

  const projectProgressPct = weightedProgressPct(
    next.map((c) => ({ weight: c.weight, progress_pct: c.next_pct })),
  );

  const disciplines = [...byDiscipline.entries()]
    .map(([discipline, progressPct]) => ({
      discipline,
      progressPct,
      cwpCount: packages.filter((p) => p.discipline === discipline).length,
    }))
    .sort((a, b) => (a.discipline < b.discipline ? -1 : 1));

  return {
    disciplines,
    updatedCwps: updated,
    projectProgressPct,
    evmInput: { projectProgressPct, source: "quantity_progress" },
  };
}

// ---------------------------------------------------------------------------
// Productivity
// ---------------------------------------------------------------------------
export type ProductivityDimension = "discipline" | "area" | "trade";

export interface ProductivitySummary {
  rows: ProductivityRow[];
  weekly: Array<{ week: string; qty: number; hours: number; unitsPerManhour: number | null }>;
  totalQty: number;
  totalHours: number;
}

export async function buildProductivity(
  client: Client,
  projectId: string,
  dimension: ProductivityDimension,
  from: string,
  to: string,
  minCrew: number,
): Promise<ProductivitySummary> {
  const { data: dprs, error } = await client
    .from("construction_daily_reports")
    .select("id, report_date, quantities, total_manpower")
    .eq("project_id", projectId)
    .eq("status", "approved")
    .gte("report_date", from)
    .lte("report_date", to);
  if (error) throw error;

  const reports = ((dprs ?? []) as Array<{
    id: string;
    report_date: string;
    quantities: unknown;
    total_manpower: number | string;
  }>).filter((d) => Number(d.total_manpower ?? 0) >= minCrew);

  const dprIds = reports.map((d) => d.id);
  let logs: Array<{ dpr_id: string; trade: string; hours: number | string }> = [];
  if (dprIds.length) {
    const { data: manpower, error: mErr } = await client
      .from("manpower_logs")
      .select("dpr_id, trade, hours")
      .in("dpr_id", dprIds);
    if (mErr) throw mErr;
    logs = (manpower ?? []) as typeof logs;
  }

  const hoursByDpr = new Map<string, number>();
  const hoursByDprTrade = new Map<string, number>();
  for (const l of logs) {
    const h = Number(l.hours ?? 0);
    hoursByDpr.set(l.dpr_id, (hoursByDpr.get(l.dpr_id) ?? 0) + h);
    const k = `${l.dpr_id}|${l.trade}`;
    hoursByDprTrade.set(k, (hoursByDprTrade.get(k) ?? 0) + h);
  }

  const facts: ProductivityFact[] = [];
  const weeklyFacts: ProductivityFact[] = [];
  for (const r of reports) {
    const list = Array.isArray(r.quantities) ? (r.quantities as DprQuantity[]) : [];
    const qty = list.reduce((s, q) => s + (Number(q.quantity) || 0), 0);
    const hours = hoursByDpr.get(r.id) ?? 0;
    const week = mondayIso(r.report_date);
    weeklyFacts.push({ bucket: week, qty, hours });

    if (dimension === "trade") {
      const trades = [...new Set(logs.filter((l) => l.dpr_id === r.id).map((l) => l.trade))];
      const share = trades.length ? qty / trades.length : 0;
      for (const t of trades) {
        facts.push({ bucket: t, qty: share, hours: hoursByDprTrade.get(`${r.id}|${t}`) ?? 0 });
      }
      if (!trades.length) facts.push({ bucket: "unassigned", qty, hours: 0 });
    } else {
      const groups = new Map<string, number>();
      for (const q of list) {
        const key =
          dimension === "area" ? (q.area ?? "unassigned") : (q.discipline ?? "general") || "general";
        groups.set(key, (groups.get(key) ?? 0) + (Number(q.quantity) || 0));
      }
      if (groups.size === 0) groups.set("unassigned", 0);
      const totalQty = [...groups.values()].reduce((s, v) => s + v, 0);
      for (const [bucket, bQty] of groups) {
        const hourShare = totalQty > 0 ? hours * (bQty / totalQty) : hours / groups.size;
        facts.push({ bucket, qty: bQty, hours: hourShare });
      }
    }
  }

  const weekly = productivityRows(weeklyFacts).map((w) => ({
    week: w.bucket,
    qty: w.qty,
    hours: w.hours,
    unitsPerManhour: w.unitsPerManhour,
  }));

  return {
    rows: productivityRows(facts),
    weekly,
    totalQty: Number(facts.reduce((s, f) => s + f.qty, 0).toFixed(2)),
    totalHours: Number(facts.reduce((s, f) => s + f.hours, 0).toFixed(2)),
  };
}

function mondayIso(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
