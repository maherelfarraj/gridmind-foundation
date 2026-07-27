// P-200 — Period close server functions.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  ClosePeriodSchema,
  ReopenPeriodSchema,

  ComparePeriodsSchema,
  SaveChecklistSchema,
  canClose,
  comparisonLines,
  shiftMonth,
  type ComparisonLine,
  type PeriodTotals,
} from "@/lib/periods.rules";
import {
  assertPeriodRead,
  assertPeriodWrite,
  checklistFor,
  closePeriod,
  ensureCurrentPeriods,
  loadPeriods,
  periodCompanyId,
  reopenPeriod,
  resolvePeriodAccess,
  saveChecklist,
  totalsFor,
  type PeriodListRow,
} from "@/lib/periods.server";
import { httpError } from "@/lib/payments.server";

export const getFinancePeriods = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const access = await resolvePeriodAccess(context);
    assertPeriodRead(access);
    const companyId = await periodCompanyId(context);
    await ensureCurrentPeriods(context, companyId);
    const periods = await loadPeriods(context, companyId);
    const rows: PeriodListRow[] = [];
    for (const p of periods.slice(0, 12)) {
      const checklist = p.status === "closed" ? [] : await checklistFor(context, companyId, p);
      rows.push({ ...p, checklist, can_close: p.status !== "closed" && canClose(checklist) });
    }
    return { access, periods: rows };
  });

export const closeFinancePeriod = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((d: unknown) => ClosePeriodSchema.parse(d))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const access = await resolvePeriodAccess(context);
    assertPeriodWrite(access);
    const companyId = await periodCompanyId(context);
    const periods = await loadPeriods(context, companyId);
    const period = periods.find((p) => p.period_month === data.period_month);
    if (!period) httpError(404, "period_not_found");
    if (period.status === "closed") httpError(409, "period_already_closed");
    const checklist = await checklistFor(context, companyId, period);
    if (!canClose(checklist)) {
      httpError(409, "checklist_incomplete", "Resolve every checklist item before closing.", {
        checklist,
      });
    }
    await closePeriod(context, companyId, data.period_month);
    return { ok: true };
  });

export const reopenFinancePeriod = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((d: unknown) => ReopenPeriodSchema.parse(d))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const access = await resolvePeriodAccess(context);
    if (access !== "reopen") {
      httpError(403, "forbidden", "Only company admins can reopen a closed period.");
    }
    const companyId = await periodCompanyId(context);
    await reopenPeriod(context, companyId, data.period_month, data.reason);
    return { ok: true };
  });


export const saveFinancePeriodChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((d: unknown) => SaveChecklistSchema.parse(d))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const access = await resolvePeriodAccess(context);
    assertPeriodWrite(access);
    const companyId = await periodCompanyId(context);
    await saveChecklist(context, companyId, data.period_month, data.unbilled_reviewed, data.note);
    return { ok: true };
  });

export const getPeriodComparison = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((d: unknown) => ComparePeriodsSchema.parse(d))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const access = await resolvePeriodAccess(context);
    assertPeriodRead(access);
    const companyId = await periodCompanyId(context);
    const priorMonth = shiftMonth(data.period_month, -1);
    const [current, prior] = await Promise.all([
      totalsFor(context, companyId, data.period_month),
      totalsFor(context, companyId, priorMonth),
    ]);
    const lines: ComparisonLine[] = comparisonLines(current, prior);
    return { current, prior, lines } satisfies {
      current: PeriodTotals;
      prior: PeriodTotals;
      lines: ComparisonLine[];
    };
  });
