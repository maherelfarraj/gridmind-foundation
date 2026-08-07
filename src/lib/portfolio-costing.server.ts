// GC-08 — Portfolio Cost & Close: authorized company-wide aggregation.
//
// Reads are set-based: a fixed number of company-scoped queries regardless of
// how many projects are in scope (no N+1, no per-project workspace loads).
// Every figure originates from an existing authoritative row — frozen forecast
// snapshots, the budget ledger, recorded payments, costing periods, close
// checklists and exceptions. Nothing is recomputed or stored back.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasCloseRole, loadCostingSettings } from "@/lib/costing.close.server";
import {
  closeGate,
  isExceptionOpen,
  isOverdue,
  type ChecklistItem,
  type CloseException,
  type ClosePolicy,
} from "@/lib/costing.checklist";
import { loadClosePolicy } from "@/lib/costing.checklist.server";
import { resolveFx, sumMoney, convertMoney } from "@/lib/costing.fx";
import {
  currentReportingPeriod,
  mostRestrictiveState,
  reportingToday,
  type CostingPeriodState,
} from "@/lib/costing.periods";
import { costingAudit, costingHttpError } from "@/lib/costing.server";
import {
  buildVariance,
  closeMatrixSummary,
  consolidate,
  deriveMeasures,
  officialGate,
  reconcile,
  topMovers,
  translateMeasures,
  EMPTY_TOTALS,
  type CloseMatrixSummary,
  type ConsolidationBasis,
  type ConsolidationRate,
  type OfficialGate,
  type PortfolioConsolidation,
  type PortfolioCostingQuery,
  type PortfolioLedgerMeasures,
  type PortfolioProjectRow,
  type PortfolioSnapshotTotals,
  type Reconciliation,
  type SnapshotBasisKind,
} from "@/lib/portfolio-costing.rules";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return (data ?? []) as T[];
}

/** Last calendar day of a `YYYY-MM-01` period. */
export function periodEndOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const end = new Date(Date.UTC(y!, m!, 0));
  return end.toISOString().slice(0, 10);
}

function prevPeriodMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await sbOf(ctx)
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user?.id ?? "")
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id ?? null;
  if (!companyId) costingHttpError(400, "no_company", "No active company context.");
  return companyId as string;
}

// ---------------------------------------------------------------------------
// FX pair resolution — one query for every pair the consolidation needs.
// ---------------------------------------------------------------------------
interface RateRow {
  base_code: string;
  quote_code: string;
  rate: number;
  as_of: string;
}

async function loadPairRates(
  ctx: AuthContext,
  bases: string[],
  quotes: string[],
  asOf: string,
): Promise<Map<string, { rate: number; as_of: string }>> {
  const map = new Map<string, { rate: number; as_of: string }>();
  const b = bases.filter((c) => !quotes.includes(c) || true);
  if (b.length === 0 || quotes.length === 0) return map;
  const data = await rows<RateRow>(
    sbOf(ctx)
      .from("fx_rates")
      .select("base_code, quote_code, rate, as_of")
      .in("base_code", b)
      .in("quote_code", quotes)
      .lte("as_of", asOf)
      .order("as_of", { ascending: false })
      // FX-01 — manual rows outrank imported rows for the same pair + date.
      .order("source_priority", { ascending: true }),
  );
  for (const r of data) {
    const key = `${r.base_code}>${r.quote_code}`;
    if (!map.has(key)) map.set(key, { rate: Number(r.rate), as_of: r.as_of });
  }
  return map;
}

function rateFor(
  pairs: Map<string, { rate: number; as_of: string }>,
  from: string,
  to: string,
  onDate: string,
): ConsolidationRate {
  const res = resolveFx({
    txnCurrency: from,
    baseCurrency: to,
    onDate,
    tableRate: pairs.get(`${from}>${to}`) ?? null,
  });
  return {
    rate: res.rate,
    as_of: res.rate_date,
    source: res.source,
    stale: res.stale,
    missing: res.missing,
  };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------
export interface PortfolioCostingData {
  company_id: string;
  period: string;
  current_period: string;
  prior_period: string;
  period_end: string;
  basis: ConsolidationBasis;
  /** Date the consolidation rates are effective for. */
  rate_date: string;
  reporting_currency: string;
  currency_options: string[];
  today: string;
  rows: PortfolioProjectRow[];
  consolidation: PortfolioConsolidation;
  gate: OfficialGate;
  close: CloseMatrixSummary;
  movers: PortfolioProjectRow[];
  reconciliation: Reconciliation;
  policy: ClosePolicy;
  materiality: { abs: number; pct: number };
  /** Prior-period consolidated EAC (same reporting currency and basis). */
  trend: { period: string; eac: number; budget_current: number }[];
}

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string | null;
}

interface VersionRow {
  id: string;
  project_id: string;
  reporting_period: string;
  version_no: number;
  status: string;
  label: string | null;
  approved_at: string | null;
  base_currency_code: string;
  materiality_explanation: string | null;
  totals: Partial<PortfolioSnapshotTotals> | null;
}

function totalsOf(v: VersionRow | null): PortfolioSnapshotTotals {
  const t = v?.totals ?? null;
  if (!t) return { ...EMPTY_TOTALS };
  return {
    budget_current: Number(t.budget_current ?? 0),
    committed: Number(t.committed ?? 0),
    actual: Number(t.actual ?? 0),
    accruals: Number(t.accruals ?? 0),
    etc: Number(t.etc ?? 0),
    eac: Number(t.eac ?? 0),
    vac: Number(t.vac ?? 0),
  };
}

/** Approved wins; otherwise the highest working/submitted version is indicative. */
function pickForPeriod(versions: VersionRow[]): {
  row: VersionRow | null;
  basis: SnapshotBasisKind;
} {
  const approved = versions.find((v) => v.status === "approved");
  if (approved) return { row: approved, basis: "approved" };
  const other = versions
    .filter((v) => v.status === "submitted" || v.status === "working")
    .sort((a, b) => b.version_no - a.version_no)[0];
  if (other) return { row: other, basis: "indicative" };
  const superseded = versions
    .filter((v) => v.status === "superseded")
    .sort((a, b) => b.version_no - a.version_no)[0];
  return superseded ? { row: superseded, basis: "indicative" } : { row: null, basis: "none" };
}

export async function loadPortfolioCosting(
  ctx: AuthContext,
  query: PortfolioCostingQuery = {},
): Promise<PortfolioCostingData> {
  if (!(await hasCloseRole(ctx))) {
    costingHttpError(
      403,
      "forbidden",
      "Portfolio cost & close is restricted to finance leadership.",
    );
  }
  const companyId = await currentCompanyId(ctx);
  return buildPortfolioCosting(ctx, companyId, query);
}

/**
 * Authorization-free core so background evaluators (GC-10 alerts) can reuse
 * the *same* authoritative aggregation for a company they were handed, instead
 * of re-implementing the money. Callers are responsible for authorizing first:
 * `loadPortfolioCosting` does it for user sessions, the scheduled evaluator
 * runs service-role and is guarded by the public-hook cron guard.
 */
export async function buildPortfolioCosting(
  ctx: AuthContext,
  companyId: string,
  query: PortfolioCostingQuery = {},
  opts: { audit?: boolean } = {},
): Promise<PortfolioCostingData> {
  const settings = await loadCostingSettings(ctx, companyId);

  const today = reportingToday(settings.reporting_timezone);
  const currentPeriod = currentReportingPeriod(settings.reporting_timezone);
  const period = query.period ?? currentPeriod;
  const prior = prevPeriodMonth(period);
  const period_end = periodEndOf(period);
  const basis: ConsolidationBasis = query.basis ?? "period_end";
  const rate_date = basis === "latest" ? today : period_end;

  const [projects, configs, versions, periods, items, exceptions, budgets, payments, policy] =
    await Promise.all([
      rows<ProjectRow>(
        sbOf(ctx)
          .from("projects")
          .select("id, code, name, status")
          .eq("company_id", companyId)
          .order("code"),
      ),
      rows<{ project_id: string; currency_code: string | null }>(
        sbOf(ctx).from("project_financial_config").select("project_id, currency_code"),
      ),
      rows<VersionRow>(
        sbOf(ctx)
          .from("forecast_versions")
          .select(
            "id, project_id, reporting_period, version_no, status, label, approved_at, base_currency_code, materiality_explanation, totals",
          )
          .eq("company_id", companyId)
          .lte("reporting_period", period)
          .order("reporting_period", { ascending: true })
          .order("version_no", { ascending: true }),
      ),
      rows<{ project_id: string | null; period_month: string; state: CostingPeriodState }>(
        sbOf(ctx)
          .from("costing_periods")
          .select("project_id, period_month, state")
          .eq("company_id", companyId)
          .eq("period_month", period),
      ),
      rows<Record<string, unknown>>(
        sbOf(ctx)
          .from("costing_checklist_items")
          .select(
            "id, project_id, seq, category, title, is_required, requires_evidence, owner_role, due_date, status, assignee_id, reviewer_id, completed_by, completed_at, reviewed_by, reviewed_at, waived_by, waived_at, waiver_reason, ready_at, row_version, updated_at",
          )
          .eq("company_id", companyId)
          .eq("period_month", period),
      ),
      rows<Record<string, unknown>>(
        sbOf(ctx)
          .from("costing_exceptions")
          .select(
            "id, project_id, period_month, source, exception_type, severity, entity_table, entity_id, fingerprint, title, detail, status, owner_id, due_date, resolution_note, resolved_by, resolved_at, approved_by, approved_at, reopen_count, first_seen_at, last_seen_at, row_version, updated_at",
          )
          .eq("company_id", companyId)
          .eq("period_month", period),
      ),
      rows<{
        project_id: string;
        currency_code: string;
        original_amount: number | null;
        approved_changes: number | null;
      }>(
        sbOf(ctx)
          .from("budgets")
          .select("project_id, currency_code, original_amount, approved_changes")
          .eq("company_id", companyId),
      ),
      rows<{
        project_id: string | null;
        currency_code: string;
        base_currency_code: string | null;
        amount: number | null;
        amount_base: number | null;
      }>(
        sbOf(ctx)
          .from("payments")
          .select("project_id, currency_code, base_currency_code, amount, amount_base")
          .eq("company_id", companyId)
          .eq("direction", "payable")
          .eq("record_status", "recorded")
          .lte("payment_date", period_end),
      ),
      loadClosePolicy(ctx, companyId),
    ]);

  // --- project currency -----------------------------------------------------
  const configByProject = new Map(configs.map((c) => [c.project_id, c.currency_code ?? null]));
  const currencyOf = (projectId: string) => (configByProject.get(projectId) ?? "USD").toUpperCase();

  const projectCurrencies = [...new Set(projects.map((p) => currencyOf(p.id)))].sort();
  const reporting_currency = (query.currency ?? projectCurrencies[0] ?? "USD").toUpperCase();
  const currency_options = [...new Set([...projectCurrencies, reporting_currency, "USD"])].sort();

  // --- FX (one query for every pair) ---------------------------------------
  const ledgerCurrencies = [
    ...new Set([
      ...budgets.map((b) => (b.currency_code ?? "").toUpperCase()),
      ...payments.map((p) => (p.currency_code ?? "").toUpperCase()),
    ]),
  ].filter(Boolean);
  const pairs = await loadPairRates(
    ctx,
    [...new Set([...ledgerCurrencies, ...projectCurrencies])],
    [...new Set([...projectCurrencies, reporting_currency])],
    rate_date,
  );

  // --- indexes --------------------------------------------------------------
  const versionsByProject = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const list = versionsByProject.get(v.project_id) ?? [];
    list.push(v);
    versionsByProject.set(v.project_id, list);
  }
  const companyState =
    periods.find((p) => p.project_id === null)?.state ?? ("open" as CostingPeriodState);
  const stateByProject = new Map(
    periods.filter((p) => p.project_id).map((p) => [p.project_id as string, p.state]),
  );
  const itemsByProject = new Map<string, ChecklistItem[]>();
  for (const raw of items) {
    const pid = String(raw["project_id"]);
    const item = {
      id: String(raw["id"]),
      seq: Number(raw["seq"] ?? 0),
      category: String(raw["category"] ?? ""),
      title: String(raw["title"] ?? ""),
      instructions: null,
      is_required: Boolean(raw["is_required"]),
      requires_evidence: Boolean(raw["requires_evidence"]),
      owner_role: (raw["owner_role"] as string | null) ?? null,
      due_date: (raw["due_date"] as string | null) ?? null,
      status: raw["status"] as ChecklistItem["status"],
      assignee_id: (raw["assignee_id"] as string | null) ?? null,
      reviewer_id: (raw["reviewer_id"] as string | null) ?? null,
      notes: null,
      completed_by: (raw["completed_by"] as string | null) ?? null,
      completed_at: (raw["completed_at"] as string | null) ?? null,
      reviewed_by: (raw["reviewed_by"] as string | null) ?? null,
      reviewed_at: (raw["reviewed_at"] as string | null) ?? null,
      waived_by: (raw["waived_by"] as string | null) ?? null,
      waived_at: (raw["waived_at"] as string | null) ?? null,
      waiver_reason: (raw["waiver_reason"] as string | null) ?? null,
      ready_at: (raw["ready_at"] as string | null) ?? null,
      row_version: Number(raw["row_version"] ?? 1),
      // Evidence completeness is enforced project-side; the portfolio view
      // never re-judges it, so it must not fabricate a blocker here.
      evidence_count: 1,
    } satisfies ChecklistItem;
    const list = itemsByProject.get(pid) ?? [];
    list.push(item);
    itemsByProject.set(pid, list);
  }
  const exceptionsByProject = new Map<string, CloseException[]>();
  const lastActionByProject = new Map<string, string>();
  for (const raw of exceptions) {
    const pid = String(raw["project_id"]);
    const list = exceptionsByProject.get(pid) ?? [];
    list.push(raw as unknown as CloseException);
    exceptionsByProject.set(pid, list);
  }
  for (const raw of [...items, ...exceptions]) {
    const pid = String(raw["project_id"]);
    const at = (raw["updated_at"] as string | null) ?? null;
    if (at && (!lastActionByProject.get(pid) || at > lastActionByProject.get(pid)!)) {
      lastActionByProject.set(pid, at);
    }
  }

  const budgetsByProject = new Map<string, typeof budgets>();
  for (const b of budgets) {
    const list = budgetsByProject.get(b.project_id) ?? [];
    list.push(b);
    budgetsByProject.set(b.project_id, list);
  }
  const paymentsByProject = new Map<string, typeof payments>();
  for (const p of payments) {
    if (!p.project_id) continue;
    const list = paymentsByProject.get(p.project_id) ?? [];
    list.push(p);
    paymentsByProject.set(p.project_id, list);
  }

  // --- per-project rows -----------------------------------------------------
  const built: PortfolioProjectRow[] = projects.map((p) => {
    const currency = currencyOf(p.id);
    const all = versionsByProject.get(p.id) ?? [];
    const pick = pickForPeriod(all.filter((v) => v.reporting_period === period));
    const priorApproved =
      all.filter((v) => v.reporting_period === prior && v.status === "approved").slice(-1)[0] ??
      null;
    const baseline =
      all.filter((v) => v.status === "approved" || v.status === "superseded")[0] ?? null;

    // Ledger measures (project currency, as-at the period end).
    const fxMissing = new Set<string>();
    const toProject = (amount: number, from: string): number | null => {
      const cur = (from || currency).toUpperCase();
      if (cur === currency) return amount;
      const r = rateFor(pairs, cur, currency, rate_date);
      if (r.missing || r.rate === null) {
        fxMissing.add(cur);
        return null;
      }
      return convertMoney(amount, r.rate);
    };
    const sumLedger = (values: (number | null)[]): number | null =>
      values.some((v) => v === null) ? null : sumMoney(values as number[]);

    const projBudgets = budgetsByProject.get(p.id) ?? [];
    const original = sumLedger(
      projBudgets.map((b) => toProject(Number(b.original_amount ?? 0), b.currency_code)),
    );
    const approvedChanges = sumLedger(
      projBudgets.map((b) => toProject(Number(b.approved_changes ?? 0), b.currency_code)),
    );
    const paid = sumLedger(
      (paymentsByProject.get(p.id) ?? []).map((row) => {
        const rowBase = (row.base_currency_code ?? "").toUpperCase();
        if (rowBase === currency && row.amount_base !== null) return Number(row.amount_base);
        return toProject(Number(row.amount ?? 0), row.currency_code);
      }),
    );

    const ledger: PortfolioLedgerMeasures = {
      budget_original: original,
      budget_approved_changes: approvedChanges,
      paid,
      fx_missing: [...fxMissing].sort(),
    };

    const projectMeasures = deriveMeasures(totalsOf(pick.row), ledger);
    const rate = rateFor(pairs, currency, reporting_currency, rate_date);
    const reportingMeasures =
      pick.basis === "none" ? null : translateMeasures(projectMeasures, rate);

    const projectItems = itemsByProject.get(p.id) ?? [];
    const projectExceptions = exceptionsByProject.get(p.id) ?? [];
    const unexplained = all.filter(
      (v) =>
        v.reporting_period === period &&
        v.status === "submitted" &&
        !String(v.materiality_explanation ?? "").trim(),
    ).length;
    const gate = closeGate({
      items: projectItems,
      exceptions: projectExceptions,
      policy,
      unexplainedMaterialMovements: unexplained,
    });
    const done = projectItems.filter(
      (i) => i.status === "completed" || i.status === "waived",
    ).length;

    return {
      project_id: p.id,
      code: p.code,
      name: p.name,
      currency,
      version: pick.row
        ? {
            id: pick.row.id,
            version_no: pick.row.version_no,
            status: pick.row.status,
            label: pick.row.label,
            approved_at: pick.row.approved_at,
            reporting_period: pick.row.reporting_period,
          }
        : null,
      basis: pick.basis,
      project: projectMeasures,
      reporting: reportingMeasures,
      rate,
      ledger_fx_missing: ledger.fx_missing,
      close: {
        state: mostRestrictiveState(companyState, stateByProject.get(p.id) ?? null),
        checklist_total: projectItems.length,
        checklist_done: done,
        checklist_overdue: projectItems.filter((i) => isOverdue(i, today)).length,
        checklist_pct:
          projectItems.length === 0 ? null : Math.round((done / projectItems.length) * 1000) / 10,
        exceptions_blockers: projectExceptions.filter(
          (e) => e.severity === "blocker" && isExceptionOpen(e),
        ).length,
        exceptions_warnings: projectExceptions.filter(
          (e) => e.severity === "warning" && isExceptionOpen(e),
        ).length,
        blockers: gate.blockers.map((b) => ({ key: b.key, count: b.count })),
        ready: gate.ready,
        owners: [
          ...new Set(projectItems.map((i) => i.assignee_id).filter((x): x is string => Boolean(x))),
        ],
        last_action_at: lastActionByProject.get(p.id) ?? null,
      },
      variance: buildVariance({
        currentEac: pick.basis === "none" ? null : projectMeasures.eac,
        priorEac: priorApproved ? totalsOf(priorApproved).eac : null,
        baselineEac: baseline ? totalsOf(baseline).eac : null,
        policy: settings.materiality,
        explanation: pick.row?.materiality_explanation ?? null,
      }),
    } satisfies PortfolioProjectRow;
  });

  const consolidation = consolidate(built, reporting_currency);

  // Prior-period consolidated position, same currency and rate basis.
  const priorRows = built
    .map((r) => {
      const all = versionsByProject.get(r.project_id) ?? [];
      const v = all.find((x) => x.reporting_period === prior && x.status === "approved") ?? null;
      if (!v || r.rate.missing || r.rate.rate === null) return null;
      const t = totalsOf(v);
      return {
        eac: convertMoney(t.eac, r.rate.rate),
        budget_current: convertMoney(t.budget_current, r.rate.rate),
      };
    })
    .filter((x): x is { eac: number; budget_current: number } => x !== null);

  if (opts.audit !== false) {
    await costingAudit(ctx, "costing.portfolio.view", "forecast_versions", null, {
      company_id: companyId,
      period,
      reporting_currency,
      basis,
      projects: built.length,
      included: consolidation.included,
      excluded: consolidation.excluded.length,
    });
  }

  return {
    company_id: companyId,
    period,
    current_period: currentPeriod,
    prior_period: prior,
    period_end,
    basis,
    rate_date,
    reporting_currency,
    currency_options,
    today,
    rows: built,
    consolidation,
    gate: officialGate(built, consolidation),
    close: closeMatrixSummary(built),
    movers: topMovers(built),
    reconciliation: reconcile(built, consolidation),
    policy,
    materiality: { abs: settings.materiality.abs, pct: settings.materiality.pct },
    trend: [
      {
        period: prior,
        eac: sumMoney(priorRows.map((x) => x.eac)),
        budget_current: sumMoney(priorRows.map((x) => x.budget_current)),
      },
      {
        period,
        eac: consolidation.totals.eac,
        budget_current: consolidation.totals.budget_current,
      },
    ],
  };
}
