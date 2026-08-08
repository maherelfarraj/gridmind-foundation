// GC-16d — Governed calendar policy administration I/O layer.
//
// NON-POSTING. Writes only to calendar_holiday_sets, calendar_holiday_dates,
// calendar_policy_changes, and — through an explicit governed recalculation —
// the due_date/provenance of NON-frozen contract_deadlines. It never mutates
// costing, EVM, cash-flow, recognition or FX sources.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  assertHolidayCoverage,
  checkHolidayCoverage,
  effectiveCalendar,
  frozenReason,
  holidaySetVersionKey,
  isMaterialPolicyChange,
  previewRecalculation,
  requiredHolidayYears,
  requiresObservedHolidays,
  resolveCalendarPolicy,
  validateHolidayImport,
  CalendarConfigError,
  GOVERNED_CALENDARS,
  type CalendarGovernanceQuery,
  type EffectiveCalendar,
  type HolidayDateRecord,
  type HolidayImportInput,
  type HolidaySetDecisionInput,
  type HolidaySetInput,
  type HolidaySetRecord,
  type PolicyChangeDecisionInput,
  type PolicyChangeRecord,
  type PolicyChangeRequestInput,
  type RecalcDeadline,
  type RecalcInput,
  type RecalcPreview,
  type ResolvedPolicy,
} from "@/lib/calendar-governance.rules";
import { addBusinessDays } from "@/lib/contracts-claims.rules";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";

export const CALENDAR_REQUEST_ROLES = [
  "finance_admin",
  "project_admin",
  "company_admin",
] as const;
export const CALENDAR_APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

type AnySupabase = {
  from: (t: string) => any;
};

const db = (ctx: AuthContext) => ctx.supabase as never as AnySupabase;

async function safeRows<T>(run: () => Promise<{ data: T[] | null; error: any }>): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return [];
    throw error;
  }
  return data ?? [];
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CalendarConfigError) httpError(422, err.code, err.message);
    throw err;
  }
}

async function requireRequest(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CALENDAR_REQUEST_ROLES)))
    httpError(403, "forbidden", "Project controls or finance role required.");
}

async function requireApprove(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CALENDAR_APPROVE_ROLES)))
    httpError(403, "forbidden", "Finance or company admin role required.");
}

export interface CalendarAccess {
  canRequest: boolean;
  canApprove: boolean;
  userId: string | null;
}

export async function resolveCalendarAccess(ctx: AuthContext): Promise<CalendarAccess> {
  const [canRequest, canApprove] = await Promise.all([
    hasAnyRole(ctx, CALENDAR_REQUEST_ROLES),
    hasAnyRole(ctx, CALENDAR_APPROVE_ROLES),
  ]);
  return { canRequest, canApprove, userId: ctx.user?.id ?? null };
}

async function companyOfUser(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("current_company_id" as never);
  if (!error && typeof data === "string" && data) return data;
  const rows = await safeRows<{ company_id: string }>(() =>
    db(ctx).from("profiles").select("company_id").eq("id", ctx.user?.id ?? "").limit(1),
  );
  const companyId = rows[0]?.company_id;
  if (!companyId) httpError(403, "company_unresolved", "No company context for this user.");
  return companyId;
}

async function projectCompany(ctx: AuthContext, projectId: string): Promise<string> {
  const rows = await safeRows<{ company_id: string }>(() =>
    db(ctx).from("projects").select("company_id").eq("id", projectId).limit(1),
  );
  if (!rows[0]) httpError(404, "project_not_found", "Project not found in your company.");
  return rows[0].company_id;
}

// ---------------------------------------------------------------------------
// Holiday sets
// ---------------------------------------------------------------------------
export async function loadHolidaySets(
  ctx: AuthContext,
  companyId: string,
  calendarId?: string,
): Promise<HolidaySetRecord[]> {
  let q = db(ctx)
    .from("calendar_holiday_sets")
    .select(
      "id, calendar_id, jurisdiction, year, version, label, status, source_reference, approved_by, approved_at, created_by, row_version",
    )
    .eq("company_id", companyId);
  if (calendarId) q = q.eq("calendar_id", calendarId);
  const sets = await safeRows<any>(() => q.order("year", { ascending: true }));
  if (!sets.length) return [];

  const dates = await safeRows<any>(() =>
    db(ctx)
      .from("calendar_holiday_dates")
      .select("set_id, observed_date, label_en, label_ar, kind, source_reference")
      .in(
        "set_id",
        sets.map((s) => s.id),
      )
      .order("observed_date", { ascending: true }),
  );
  const bySet = new Map<string, HolidayDateRecord[]>();
  for (const d of dates) {
    const list = bySet.get(d.set_id) ?? [];
    list.push({
      observed_date: String(d.observed_date).slice(0, 10),
      label_en: d.label_en,
      label_ar: d.label_ar,
      kind: d.kind,
      source_reference: d.source_reference ?? null,
    });
    bySet.set(d.set_id, list);
  }
  return sets.map((s) => ({ ...s, dates: bySet.get(s.id) ?? [] })) as HolidaySetRecord[];
}

/** Governed calendar with all APPROVED observed-date sets folded in. */
export async function loadEffectiveCalendar(
  ctx: AuthContext,
  companyId: string,
  calendarId: string,
): Promise<EffectiveCalendar> {
  const base = GOVERNED_CALENDARS[calendarId as keyof typeof GOVERNED_CALENDARS];
  if (!base) httpError(422, "deadline_calendar_invalid", `Unknown governed calendar "${calendarId}".`);
  const sets = await loadHolidaySets(ctx, companyId, calendarId);
  return effectiveCalendar(base, sets);
}

export async function saveHolidaySet(
  ctx: AuthContext,
  input: HolidaySetInput,
): Promise<{ id: string }> {
  await requireApprove(ctx);
  const companyId = await companyOfUser(ctx);
  const payload = {
    company_id: companyId,
    calendar_id: input.calendar_id,
    jurisdiction: input.jurisdiction,
    year: input.year,
    version: input.version,
    label: input.label,
    source_reference: input.source_reference ?? null,
    notes: input.notes ?? null,
  };
  if (!input.id) {
    const { data, error } = await db(ctx)
      .from("calendar_holiday_sets")
      .insert({ ...payload, created_by: ctx.user?.id ?? null })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505")
        httpError(409, "holiday_set_exists", "That calendar/year/version already exists.");
      throw error;
    }
    await audit(ctx, "calendar.holiday_set.created", "calendar_holiday_sets", data.id, payload);
    return { id: data.id as string };
  }

  const current = await safeRows<{ row_version: number; status: string }>(() =>
    db(ctx).from("calendar_holiday_sets").select("row_version, status").eq("id", input.id).limit(1),
  );
  if (!current.length) httpError(404, "holiday_set_not_found", "Holiday set not found.");
  if (current[0]!.status !== "draft")
    httpError(409, "holiday_set_immutable", "Only draft holiday sets can be edited.");
  if (input.row_version !== undefined && input.row_version !== current[0]!.row_version)
    httpError(409, "stale_write", "This holiday set changed since it was loaded.");
  const { error } = await db(ctx)
    .from("calendar_holiday_sets")
    .update(payload)
    .eq("id", input.id);
  if (error) throw error;
  await audit(ctx, "calendar.holiday_set.updated", "calendar_holiday_sets", input.id, payload);
  return { id: input.id };
}

export async function importHolidayDates(ctx: AuthContext, input: HolidayImportInput) {
  await requireApprove(ctx);
  const sets = await safeRows<any>(() =>
    db(ctx)
      .from("calendar_holiday_sets")
      .select("id, company_id, year, status")
      .eq("id", input.set_id)
      .limit(1),
  );
  const set = sets[0];
  if (!set) httpError(404, "holiday_set_not_found", "Holiday set not found.");
  if (set.status !== "draft")
    httpError(409, "holiday_set_immutable", "Dates can only be imported while the set is draft.");

  const existing = await safeRows<any>(() =>
    db(ctx)
      .from("calendar_holiday_dates")
      .select("observed_date, label_en, label_ar, kind, source_reference")
      .eq("set_id", input.set_id),
  );
  const result = validateHolidayImport(
    input.rows,
    set.year,
    existing.map((e) => ({ ...e, observed_date: String(e.observed_date).slice(0, 10) })),
  );
  if (input.preview || !result.ok) return { ...result, imported: 0, preview: true };

  const { error } = await db(ctx)
    .from("calendar_holiday_dates")
    .insert(
      result.accepted.map((r) => ({
        set_id: input.set_id,
        company_id: set.company_id,
        observed_date: r.observed_date,
        label_en: r.label_en,
        label_ar: r.label_ar,
        kind: r.kind,
        source_reference: r.source_reference ?? null,
        created_by: ctx.user?.id ?? null,
      })),
    );
  if (error) throw error;
  await audit(ctx, "calendar.holiday_dates.imported", "calendar_holiday_sets", input.set_id, {
    count: result.accepted.length,
    dates: result.accepted.map((r) => r.observed_date),
  });
  return { ...result, imported: result.accepted.length, preview: false };
}

export async function decideHolidaySet(ctx: AuthContext, input: HolidaySetDecisionInput) {
  await requireApprove(ctx);
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("calendar_holiday_sets")
      .select("id, company_id, calendar_id, year, version, status, row_version, created_by")
      .eq("id", input.id)
      .limit(1),
  );
  const set = rows[0];
  if (!set) httpError(404, "holiday_set_not_found", "Holiday set not found.");
  if (input.row_version !== set.row_version)
    httpError(409, "stale_write", "This holiday set changed since it was loaded.");

  if (input.decision === "approve") {
    if (set.status !== "draft")
      httpError(409, "holiday_set_immutable", "Only a draft set can be approved.");
    if (set.created_by && set.created_by === (ctx.user?.id ?? null))
      httpError(
        409,
        "holiday_set_segregation",
        "A holiday set must be approved by someone other than its author.",
      );
    const dates = await safeRows<any>(() =>
      db(ctx).from("calendar_holiday_dates").select("observed_date").eq("set_id", input.id),
    );
    if (!dates.length)
      httpError(422, "holiday_set_empty", "Add at least one observed date before approving.");

    // Any previously approved version for the same calendar/year is superseded.
    const prior = await safeRows<any>(() =>
      db(ctx)
        .from("calendar_holiday_sets")
        .select("id, row_version")
        .eq("company_id", set.company_id)
        .eq("calendar_id", set.calendar_id)
        .eq("year", set.year)
        .eq("status", "approved"),
    );
    for (const p of prior) {
      const { error } = await db(ctx)
        .from("calendar_holiday_sets")
        .update({ status: "superseded" })
        .eq("id", p.id);
      if (error) throw error;
    }
    const { error } = await db(ctx)
      .from("calendar_holiday_sets")
      .update({
        status: "approved",
        approved_by: ctx.user?.id ?? null,
        approved_at: new Date().toISOString(),
        notes: input.note ?? null,
      })
      .eq("id", input.id);
    if (error) throw error;
    await audit(ctx, "calendar.holiday_set.approved", "calendar_holiday_sets", input.id, {
      version_key: holidaySetVersionKey(set),
      superseded: prior.map((p) => p.id),
      date_count: dates.length,
    });
    return { id: input.id, status: "approved" as const, superseded: prior.length };
  }

  if (set.status === "superseded")
    httpError(409, "holiday_set_immutable", "This set is already superseded.");
  const { error } = await db(ctx)
    .from("calendar_holiday_sets")
    .update({ status: "superseded", notes: input.note ?? null })
    .eq("id", input.id);
  if (error) throw error;
  await audit(ctx, "calendar.holiday_set.superseded", "calendar_holiday_sets", input.id, {
    version_key: holidaySetVersionKey(set),
  });
  return { id: input.id, status: "superseded" as const, superseded: 0 };
}

// ---------------------------------------------------------------------------
// Policy resolution + change governance
// ---------------------------------------------------------------------------
async function companyPolicy(ctx: AuthContext, companyId: string) {
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("costing_settings")
      .select("deadline_calendar_id, deadline_timezone, holiday_sets_enforced")
      .eq("company_id", companyId)
      .limit(1),
  );
  return {
    calendar_id: rows[0]?.deadline_calendar_id ?? null,
    timezone: rows[0]?.deadline_timezone ?? null,
    holiday_sets_enforced: Boolean(rows[0]?.holiday_sets_enforced),
  };
}

async function contractPolicy(ctx: AuthContext, contractId: string | null | undefined) {
  if (!contractId) return { calendar_id: null, timezone: null };
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("contracts")
      .select("deadline_calendar_id, deadline_timezone")
      .eq("id", contractId)
      .limit(1),
  );
  return {
    calendar_id: rows[0]?.deadline_calendar_id ?? null,
    timezone: rows[0]?.deadline_timezone ?? null,
  };
}

/**
 * GC-16d resolution used by the cockpit and by deadline calculation:
 * request → contract policy → company policy, with holiday sets folded in.
 */
export async function resolveEffectivePolicy(
  ctx: AuthContext,
  companyId: string,
  input: {
    calendar_id?: string | null;
    timezone?: string | null;
    contract_id?: string | null;
  },
): Promise<
  ResolvedPolicy & {
    effective: EffectiveCalendar;
    holiday_sets_enforced: boolean;
  }
> {
  const [company, contract] = await Promise.all([
    companyPolicy(ctx, companyId),
    contractPolicy(ctx, input.contract_id),
  ]);
  const resolved = guard(() =>
    resolveCalendarPolicy({
      request: { calendar_id: input.calendar_id ?? null, timezone: input.timezone ?? null },
      contract,
      company: { calendar_id: company.calendar_id, timezone: company.timezone },
    }),
  );
  const effective = await loadEffectiveCalendar(ctx, companyId, resolved.calendar_id);
  return { ...resolved, effective, holiday_sets_enforced: company.holiday_sets_enforced };
}

async function upcomingDeadlines(
  ctx: AuthContext,
  companyId: string,
  scope: { project_id?: string | undefined; contract_id?: string | null | undefined },
): Promise<RecalcDeadline[]> {
  let q = db(ctx)
    .from("contract_deadlines")
    .select(
      "id, label, kind, status, satisfied_at, calendar, trigger_date, duration_days, due_date, calendar_id, calendar_version",
    )
    .eq("company_id", companyId);
  if (scope.project_id) q = q.eq("project_id", scope.project_id);
  if (scope.contract_id) q = q.eq("contract_id", scope.contract_id);
  const rows = await safeRows<any>(() => q.order("due_date", { ascending: true }).limit(500));
  return rows as RecalcDeadline[];
}

export interface CalendarGovernanceView {
  access: CalendarAccess;
  company_id: string;
  company_policy: { calendar_id: string | null; timezone: string | null; holiday_sets_enforced: boolean };
  contract_policy: { calendar_id: string | null; timezone: string | null } | null;
  resolution: {
    calendar_id: string;
    calendar_version: string;
    calendar_source: string;
    timezone: string;
    chain: ResolvedPolicy["chain"];
    holiday_set_versions: readonly string[];
    covered_years: readonly number[];
  } | null;
  resolution_error: { code: string; message: string } | null;
  coverage: { ok: boolean; missing_years: number[]; message: string | null };
  holiday_sets: HolidaySetRecord[];
  pending_changes: PolicyChangeRecord[];
  recent_changes: PolicyChangeRecord[];
  affected_deadlines: RecalcDeadline[];
  calendars: { id: string; label: string; version: string; timezones: readonly string[]; requires_observed: boolean }[];
}

export async function loadCalendarGovernance(
  ctx: AuthContext,
  query: CalendarGovernanceQuery,
): Promise<CalendarGovernanceView> {
  const companyId = query.project_id
    ? await projectCompany(ctx, query.project_id)
    : await companyOfUser(ctx);
  const access = await resolveCalendarAccess(ctx);
  const company = await companyPolicy(ctx, companyId);
  const contract = query.contract_id ? await contractPolicy(ctx, query.contract_id) : null;

  let resolution: CalendarGovernanceView["resolution"] = null;
  let resolution_error: CalendarGovernanceView["resolution_error"] = null;
  let coverage = { ok: true, missing_years: [] as number[], message: null as string | null };
  let affected: RecalcDeadline[] = [];

  try {
    const resolved = resolveCalendarPolicy({
      request: null,
      contract,
      company: { calendar_id: company.calendar_id, timezone: company.timezone },
    });
    const effective = await loadEffectiveCalendar(ctx, companyId, resolved.calendar_id);
    resolution = {
      calendar_id: resolved.calendar_id,
      calendar_version: resolved.calendar_version,
      calendar_source: resolved.calendar_source,
      timezone: resolved.timezone,
      chain: resolved.chain,
      holiday_set_versions: effective.holiday_set_versions,
      covered_years: effective.covered_years,
    };
    affected = await upcomingDeadlines(ctx, companyId, {
      project_id: query.project_id,
      contract_id: query.contract_id ?? null,
    });
    const years = [
      ...new Set(
        affected
          .filter((d) => !frozenReason(d))
          .flatMap((d) => requiredHolidayYears(d.trigger_date, d.duration_days)),
      ),
    ].sort();
    const cov = checkHolidayCoverage(effective, years);
    coverage = { ok: cov.ok, missing_years: cov.missing_years, message: cov.message };
  } catch (err) {
    if (err instanceof CalendarConfigError)
      resolution_error = { code: err.code, message: err.message };
    else throw err;
  }

  const holiday_sets = await loadHolidaySets(ctx, companyId, query.calendar_id);
  const changes = (await safeRows<any>(() =>
    db(ctx)
      .from("calendar_policy_changes")
      .select("*")
      .eq("company_id", companyId)
      .order("requested_at", { ascending: false })
      .limit(50),
  )) as PolicyChangeRecord[];

  return {
    access,
    company_id: companyId,
    company_policy: company,
    contract_policy: contract,
    resolution,
    resolution_error,
    coverage,
    holiday_sets,
    pending_changes: changes.filter((c) => c.status === "pending"),
    recent_changes: changes.filter((c) => c.status !== "pending").slice(0, 20),
    affected_deadlines: affected.slice(0, 100),
    calendars: Object.values(GOVERNED_CALENDARS).map((c) => ({
      id: c.id,
      label: c.label,
      version: c.version,
      timezones: c.timezones,
      requires_observed: requiresObservedHolidays(c.id),
    })),
  };
}

async function impactPreview(
  ctx: AuthContext,
  companyId: string,
  scope: { project_id?: string | null; contract_id?: string | null },
  targetCalendarId: string,
): Promise<RecalcPreview> {
  const target = await loadEffectiveCalendar(ctx, companyId, targetCalendarId);
  const deadlines = await upcomingDeadlines(ctx, companyId, {
    project_id: scope.project_id ?? undefined,
    contract_id: scope.contract_id ?? undefined,
  });
  return previewRecalculation(deadlines, target);
}

export async function previewPolicyImpact(
  ctx: AuthContext,
  input: {
    scope: "company" | "contract";
    contract_id?: string | null;
    project_id?: string | null;
    to_calendar_id: string;
  },
): Promise<RecalcPreview & { current_calendar_id: string | null }> {
  await requireRequest(ctx);
  const companyId = input.project_id
    ? await projectCompany(ctx, input.project_id)
    : await companyOfUser(ctx);
  const current =
    input.scope === "contract"
      ? (await contractPolicy(ctx, input.contract_id)).calendar_id
      : (await companyPolicy(ctx, companyId)).calendar_id;
  const preview = await impactPreview(
    ctx,
    companyId,
    { project_id: input.project_id ?? null, contract_id: input.contract_id ?? null },
    input.to_calendar_id,
  );
  return { ...preview, current_calendar_id: current };
}

async function applyPolicy(
  ctx: AuthContext,
  change: PolicyChangeRecord & { company_id: string },
): Promise<void> {
  if (change.scope === "company") {
    const existing = await safeRows<any>(() =>
      db(ctx).from("costing_settings").select("company_id").eq("company_id", change.company_id).limit(1),
    );
    const patch = {
      deadline_calendar_id: change.to_calendar_id,
      deadline_timezone: change.to_timezone,
    };
    const { error } = existing.length
      ? await db(ctx).from("costing_settings").update(patch).eq("company_id", change.company_id)
      : await db(ctx)
          .from("costing_settings")
          .insert({ company_id: change.company_id, ...patch });
    if (error) throw error;
  } else {
    const { error } = await db(ctx)
      .from("contracts")
      .update({
        deadline_calendar_id: change.to_calendar_id,
        deadline_timezone: change.to_timezone,
      })
      .eq("id", change.contract_id);
    if (error) throw error;
  }
}

export async function requestPolicyChange(ctx: AuthContext, input: PolicyChangeRequestInput) {
  await requireRequest(ctx);
  const companyId = input.project_id
    ? await projectCompany(ctx, input.project_id)
    : await companyOfUser(ctx);

  // Idempotency: a replayed request returns the original decision record.
  const existing = (await safeRows<any>(() =>
    db(ctx)
      .from("calendar_policy_changes")
      .select("*")
      .eq("company_id", companyId)
      .eq("idempotency_key", input.idempotency_key)
      .limit(1),
  )) as PolicyChangeRecord[];
  if (existing[0]) return { ...existing[0], replayed: true };

  if (input.scope === "contract" && !input.contract_id)
    httpError(422, "contract_required", "A contract-level override needs a contract.");

  const from =
    input.scope === "contract"
      ? await contractPolicy(ctx, input.contract_id)
      : await companyPolicy(ctx, companyId);
  const to = { calendar_id: input.to_calendar_id, timezone: input.to_timezone };
  const material = isMaterialPolicyChange(from, to);

  // Validate the target pair before anything is persisted.
  guard(() =>
    resolveCalendarPolicy({ request: to, contract: null, company: null }),
  );

  const preview = await impactPreview(
    ctx,
    companyId,
    { project_id: input.project_id ?? null, contract_id: input.contract_id ?? null },
    input.to_calendar_id,
  );

  const canApprove = await hasAnyRole(ctx, CALENDAR_APPROVE_ROLES);
  const autoApply = !material && canApprove;

  const { data, error } = await db(ctx)
    .from("calendar_policy_changes")
    .insert({
      company_id: companyId,
      scope: input.scope,
      contract_id: input.contract_id ?? null,
      project_id: input.project_id ?? null,
      from_calendar_id: from.calendar_id,
      from_timezone: from.timezone,
      to_calendar_id: input.to_calendar_id,
      to_timezone: input.to_timezone,
      material,
      status: "pending",
      reason: input.reason,
      impact: {
        changed_count: preview.changed_count,
        frozen_count: preview.frozen_count,
        max_shift_days: preview.max_shift_days,
        applied_versions: preview.applied_versions,
        rows: preview.rows.slice(0, 50),
      },
      idempotency_key: input.idempotency_key,
      requested_by: ctx.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = (await safeRows<any>(() =>
        db(ctx)
          .from("calendar_policy_changes")
          .select("*")
          .eq("company_id", companyId)
          .eq("idempotency_key", input.idempotency_key)
          .limit(1),
      )) as PolicyChangeRecord[];
      if (again[0]) return { ...again[0], replayed: true };
    }
    throw error;
  }

  await audit(ctx, "calendar.policy.requested", "calendar_policy_changes", data.id, {
    scope: input.scope,
    material,
    from: from.calendar_id,
    to: input.to_calendar_id,
    impact: data.impact,
  });

  if (autoApply) {
    await applyPolicy(ctx, { ...(data as any), company_id: companyId });
    const { error: upErr } = await db(ctx)
      .from("calendar_policy_changes")
      .update({
        status: "applied",
        decided_by: ctx.user?.id ?? null,
        decided_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (upErr) throw upErr;
    await audit(ctx, "calendar.policy.applied", "calendar_policy_changes", data.id, {
      scope: input.scope,
      material: false,
    });
    return { ...(data as PolicyChangeRecord), status: "applied" as const, replayed: false };
  }

  return { ...(data as PolicyChangeRecord), replayed: false };
}

export async function decidePolicyChange(ctx: AuthContext, input: PolicyChangeDecisionInput) {
  await requireApprove(ctx);
  const rows = (await safeRows<any>(() =>
    db(ctx).from("calendar_policy_changes").select("*").eq("id", input.id).limit(1),
  )) as (PolicyChangeRecord & { company_id: string })[];
  const change = rows[0];
  if (!change) httpError(404, "policy_change_not_found", "Policy change not found.");
  if (change.status !== "pending")
    httpError(409, "policy_change_final", "This policy change was already decided.");
  if (input.row_version !== change.row_version)
    httpError(409, "stale_write", "This policy change changed since it was loaded.");
  if (
    input.decision === "approve" &&
    change.material &&
    change.requested_by &&
    change.requested_by === (ctx.user?.id ?? null)
  )
    httpError(
      409,
      "policy_change_segregation",
      "A material calendar policy change must be approved by someone other than its requester.",
    );

  if (input.decision === "reject") {
    const { error } = await db(ctx)
      .from("calendar_policy_changes")
      .update({
        status: "rejected",
        decided_by: ctx.user?.id ?? null,
        decided_at: new Date().toISOString(),
        decision_note: input.note ?? null,
      })
      .eq("id", input.id);
    if (error) throw error;
    await audit(ctx, "calendar.policy.rejected", "calendar_policy_changes", input.id, {
      note: input.note ?? null,
    });
    return { id: input.id, status: "rejected" as const };
  }

  await applyPolicy(ctx, change);
  const { error } = await db(ctx)
    .from("calendar_policy_changes")
    .update({
      status: "applied",
      decided_by: ctx.user?.id ?? null,
      decided_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
      decision_note: input.note ?? null,
    })
    .eq("id", input.id);
  if (error) throw error;
  await audit(ctx, "calendar.policy.applied", "calendar_policy_changes", input.id, {
    scope: change.scope,
    from: change.from_calendar_id,
    to: change.to_calendar_id,
    impact: change.impact,
  });
  return { id: input.id, status: "applied" as const };
}

// ---------------------------------------------------------------------------
// Explicit governed recalculation (never retroactive on frozen deadlines)
// ---------------------------------------------------------------------------
export async function recalculateDeadlines(ctx: AuthContext, input: RecalcInput) {
  await requireRequest(ctx);
  const companyId = await projectCompany(ctx, input.project_id);
  const resolved = await resolveEffectivePolicy(ctx, companyId, {
    contract_id: input.contract_id ?? null,
  });
  const deadlines = await upcomingDeadlines(ctx, companyId, {
    project_id: input.project_id,
    contract_id: input.contract_id ?? null,
  });
  const preview = previewRecalculation(deadlines, resolved.effective);

  if (!input.apply)
    return {
      applied: false,
      calendar_id: resolved.calendar_id,
      timezone: resolved.timezone,
      ...preview,
    };

  await requireApprove(ctx);
  if (!input.reason || input.reason.trim().length < 8)
    httpError(422, "reason_required", "A recalculation reason of at least 8 characters is required.");

  const { assertCostingPeriodOpen } = await import("@/lib/costing.close.server");
  const byId = new Map(deadlines.map((d) => [d.id, d]));
  const applied: { id: string; before: string; after: string }[] = [];

  for (const row of preview.rows) {
    if (row.frozen || !row.changed) continue;
    const src = byId.get(row.id)!;
    // Period lock is a hard gate; a locked deadline is left untouched.
    await assertCostingPeriodOpen(ctx, companyId, input.project_id, row.after_due_date, {
      entity: "contract_deadlines",
      entityId: row.id,
    });
    const { error } = await db(ctx)
      .from("contract_deadlines")
      .update({
        due_date: row.after_due_date,
        calendar_id: resolved.calendar_id,
        calendar_version: resolved.calendar_version,
        calendar_source: resolved.calendar_source,
        timezone: resolved.timezone,
        holiday_set_versions: resolved.effective.holiday_set_versions,
      })
      .eq("id", row.id);
    if (error) throw error;
    applied.push({ id: row.id, before: row.before_due_date, after: row.after_due_date });
    void src;
  }

  await audit(ctx, "calendar.deadlines.recalculated", "contract_deadlines", null, {
    project_id: input.project_id,
    contract_id: input.contract_id ?? null,
    calendar_id: resolved.calendar_id,
    calendar_version: resolved.calendar_version,
    applied_versions: resolved.effective.holiday_set_versions,
    reason: input.reason,
    idempotency_key: input.idempotency_key ?? null,
    before_after: applied,
    frozen_skipped: preview.rows.filter((r) => r.frozen).map((r) => ({ id: r.id, reason: r.frozen_reason })),
  });

  return {
    applied: true,
    calendar_id: resolved.calendar_id,
    timezone: resolved.timezone,
    ...preview,
    applied_rows: applied,
  };
}

export {
  assertHolidayCoverage,
  addBusinessDays,
  checkHolidayCoverage,
  requiredHolidayYears,
};
