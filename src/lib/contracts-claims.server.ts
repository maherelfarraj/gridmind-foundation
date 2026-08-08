// GC-16 — Governed Contract & Claims Control I/O layer.
//
// NON-POSTING by construction: this module writes only to the contract_claims,
// contract_claim_events, contract_claim_valuations, contract_deadlines,
// contract_claim_snapshots(+lines) and contract_claim_alerts tables. It READS
// contracts, change orders, bonds, forecasts and EVM/cash-flow snapshots and
// never mutates them. Every write is guarded by role, delegation threshold,
// segregation of duties, period lock, optimistic concurrency and lifecycle
// rules, and emits an append-only event row.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveCostingFx } from "@/lib/costing.server";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";
import {
  alertActionToState,
  approvalBlockers,
  assertClaimTransition,
  canTransitionAlert,
  calendarProvenance,
  CalendarConfigError,
  canTransitionSnapshot,
  claimExposure,
  concentrationBy,
  computeDueDate,
  CONTRACTS_CLAIMS_DISCLAIMER,
  deriveExceptions,
  effectiveAlertState,
  evaluateClaimAlerts,
  evaluateDeadline,
  exposureWaterfall,
  isFrozen,
  reconcile,
  requiresApprovalRole,
  resolveGovernedCalendar,
  zonedTodayIso,
  resolveGovernedTimezone,
  rollupClaims,
  rollupPortfolio,
  snapshotChecksum,
  violatesSegregation,
  withinDelegation,
  type AlertState,
  type ClaimAlert,
  type ClaimAlertActionInput,
  type ClaimException,
  type ClaimRecord,
  type ClaimSnapshotBuildInput,
  type ClaimSnapshotTransitionInput,
  type ClaimStatus,
  type ClaimTransitionInput,
  type ClaimUpsertInput,
  type ClaimValuationInput,
  type DeadlineInputSchema,
  type DeadlineRecord,
  type ExposureTotals,
  type GovernedCalendar,
  type JsonRecord,
  type PortfolioClaimsQuery,
  type PortfolioProjectExposure,
  type ReconciliationCheck,
  type SnapshotStatus,
  type WaterfallStep,
} from "@/lib/contracts-claims.rules";

export { CONTRACTS_CLAIMS_DISCLAIMER };

export const CLAIMS_WRITE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;
export const CLAIMS_APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

export interface ClaimsAccess {
  canWrite: boolean;
  canApprove: boolean;
  roles: string[];
}

export async function resolveClaimsAccess(ctx: AuthContext): Promise<ClaimsAccess> {
  const [canWrite, canApprove] = await Promise.all([
    hasAnyRole(ctx, CLAIMS_WRITE_ROLES),
    hasAnyRole(ctx, CLAIMS_APPROVE_ROLES),
  ]);
  const roles: string[] = [];
  if (canWrite) roles.push("project_admin");
  if (canApprove) roles.push("finance_admin");
  return { canWrite, canApprove, roles };
}

async function requireWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CLAIMS_WRITE_ROLES)))
    httpError(403, "forbidden", "Project controls or finance role required.");
}

async function requireApprove(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CLAIMS_APPROVE_ROLES)))
    httpError(403, "forbidden", "Finance or company admin role required.");
}

async function safeRows<T>(
  run: () => Promise<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return [];
    throw error;
  }
  return data ?? [];
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

async function projectContext(
  ctx: AuthContext,
  projectId: string,
): Promise<{ company_id: string; name: string; currency: string }> {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found", "Project not found in your company.");
  const row = data as unknown as { company_id: string; name: string };
  const cfg = await safeRows<{ currency_code: string | null }>(() =>
    (ctx.supabase as never as AnySupabase)
      .from("project_financial_config")
      .select("currency_code")
      .eq("project_id", projectId),
  );
  return {
    company_id: row.company_id,
    name: row.name,
    currency: (cfg[0]?.currency_code ?? "USD").toUpperCase(),
  };
}

// The generated Database type does not yet include the GC-16 tables in every
// consumer; a narrow local alias keeps the casts explicit and auditable.
type AnySupabase = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
const db = (ctx: AuthContext): AnySupabase => ctx.supabase as never as AnySupabase;

async function logEvent(
  ctx: AuthContext,
  row: {
    company_id: string;
    project_id?: string | null;
    claim_id?: string | null;
    entity_type: string;
    entity_id?: string | null;
    event_type: string;
    from_status?: string | null;
    to_status?: string | null;
    detail?: JsonRecord;
  },
): Promise<void> {
  const { error } = await db(ctx)
    .from("contract_claim_events")
    .insert({ ...row, detail: row.detail ?? {}, actor_id: ctx.user?.id ?? null });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Claims CRUD + lifecycle
// ---------------------------------------------------------------------------
export async function saveClaim(
  ctx: AuthContext,
  input: ClaimUpsertInput,
): Promise<{ id: string; row_version: number }> {
  await requireWrite(ctx);
  const proj = await projectContext(ctx, input.project_id);
  const payload = {
    company_id: proj.company_id,
    project_id: input.project_id,
    contract_id: input.contract_id ?? null,
    claim_ref: input.claim_ref,
    title: input.title,
    kind: input.kind,
    clause_ref: input.clause_ref ?? null,
    entitlement_basis: input.entitlement_basis ?? null,
    cause: input.cause ?? null,
    effect: input.effect ?? null,
    mitigation: input.mitigation ?? null,
    quantum_basis: input.quantum_basis ?? null,
    is_back_to_back: input.is_back_to_back ?? false,
    back_to_back_ref: input.back_to_back_ref ?? null,
    currency_code: input.currency_code.toUpperCase(),
    asserted_amount: input.asserted_amount ?? 0,
    submitted_amount: input.submitted_amount ?? 0,
    assessed_amount: input.assessed_amount ?? 0,
    approved_amount: input.approved_amount ?? 0,
    forecast_amount: input.forecast_amount ?? 0,
    certified_amount: input.certified_amount ?? 0,
    paid_amount: input.paid_amount ?? 0,
    at_risk_amount: input.at_risk_amount ?? 0,
    eot_days_claimed: input.eot_days_claimed ?? 0,
    eot_days_assessed: input.eot_days_assessed ?? 0,
    eot_days_approved: input.eot_days_approved ?? 0,
    ld_exposure: input.ld_exposure ?? 0,
    event_date: input.event_date ?? null,
    awareness_date: input.awareness_date ?? null,
    notice_due_at: input.notice_due_at ?? null,
    notice_served_at: input.notice_served_at ?? null,
    submission_due_at: input.submission_due_at ?? null,
    submitted_at: input.submitted_at ?? null,
    response_due_at: input.response_due_at ?? null,
    responded_at: input.responded_at ?? null,
    limitation_at: input.limitation_at ?? null,
    owner_id: input.owner_id ?? null,
    evidence: (input.evidence ?? []) as unknown as JsonRecord[],
  };

  if (!input.id) {
    const { data, error } = await db(ctx)
      .from("contract_claims")
      .insert({ ...payload, created_by: ctx.user?.id ?? null })
      .select("id, row_version")
      .single();
    if (error) throw error;
    await logEvent(ctx, {
      company_id: proj.company_id,
      project_id: input.project_id,
      claim_id: data.id,
      entity_type: "claim",
      entity_id: data.id,
      event_type: "created",
      to_status: "draft",
      detail: { claim_ref: input.claim_ref },
    });
    await audit(ctx, "contract_claim.create", "contract_claims", data.id, {
      claim_ref: input.claim_ref,
    });
    return { id: data.id as string, row_version: Number(data.row_version) };
  }

  const current = await loadClaimRow(ctx, input.id);
  if (input.row_version !== undefined && input.row_version !== current.row_version)
    httpError(409, "stale_write", "This claim changed since it was loaded. Reload and retry.");
  if (isTerminal(current.status))
    httpError(409, "claim_immutable", "Closed, paid or withdrawn claims are read-only.");

  const { data, error } = await db(ctx)
    .from("contract_claims")
    .update({ ...payload, row_version: current.row_version })
    .eq("id", input.id)
    .select("id, row_version")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id: proj.company_id,
    project_id: input.project_id,
    claim_id: input.id,
    entity_type: "claim",
    entity_id: input.id,
    event_type: "updated",
    detail: { claim_ref: input.claim_ref },
  });
  await audit(ctx, "contract_claim.update", "contract_claims", input.id, {
    claim_ref: input.claim_ref,
  });
  return { id: data.id as string, row_version: Number(data.row_version) };
}

function isTerminal(status: ClaimStatus): boolean {
  return status === "closed" || status === "withdrawn" || status === "paid";
}

async function loadClaimRow(ctx: AuthContext, claimId: string): Promise<any> {
  const { data, error } = await db(ctx)
    .from("contract_claims")
    .select("*")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "claim_not_found", "Claim not found in your company.");
  return data;
}

export async function transitionClaim(
  ctx: AuthContext,
  input: ClaimTransitionInput,
): Promise<{ id: string; status: ClaimStatus; row_version: number }> {
  const row = await loadClaimRow(ctx, input.claim_id);
  const from = row.status as ClaimStatus;
  if (requiresApprovalRole(input.to)) await requireApprove(ctx);
  else await requireWrite(ctx);

  // Idempotency — a replayed transition is a no-op, not a second event.
  if (input.idempotency_key) {
    const prior = await safeRows<{ id: string }>(() =>
      db(ctx)
        .from("contract_claim_events")
        .select("id")
        .eq("claim_id", input.claim_id)
        .eq("event_type", `transition:${input.idempotency_key}`)
        .limit(1),
    );
    if (prior.length)
      return { id: input.claim_id, status: from, row_version: Number(row.row_version) };
  }

  if (row.row_version !== input.row_version)
    httpError(409, "stale_write", "This claim changed since it was loaded. Reload and retry.");

  try {
    assertClaimTransition(from, input.to);
  } catch {
    httpError(422, "invalid_transition", `A claim cannot move from ${from} to ${input.to}.`);
  }

  if (
    violatesSegregation({
      to: input.to,
      actorId: ctx.user?.id ?? null,
      preparedBy: (row.created_by as string) ?? null,
    })
  )
    httpError(
      403,
      "segregation_of_duties",
      "The preparer of a claim cannot approve, certify or close it.",
    );

  const access = await resolveClaimsAccess(ctx);
  const value = n(row.approved_amount) || n(row.assessed_amount) || n(row.submitted_amount);
  const roles = access.canApprove
    ? ["project_admin", "finance_admin"]
    : access.canWrite
      ? ["project_admin"]
      : [];
  if (requiresApprovalRole(input.to) && !withinDelegation(value, roles))
    httpError(403, "delegation_exceeded", "This value exceeds your delegated authority.");

  const patch: Record<string, unknown> = { status: input.to, row_version: row.row_version };
  const now = new Date().toISOString();
  if (input.to === "approved") {
    patch.approved_by = ctx.user?.id ?? null;
    patch.approved_at = now;
  }
  if (input.to === "certified") {
    patch.certified_by = ctx.user?.id ?? null;
    patch.certified_at = now;
  }
  if (input.to === "closed" || input.to === "withdrawn") patch.closed_at = now;

  const { data, error } = await db(ctx)
    .from("contract_claims")
    .update(patch)
    .eq("id", input.claim_id)
    .select("id, status, row_version")
    .single();
  if (error) throw error;

  await logEvent(ctx, {
    company_id: row.company_id,
    project_id: row.project_id,
    claim_id: input.claim_id,
    entity_type: "claim",
    entity_id: input.claim_id,
    event_type: input.idempotency_key ? `transition:${input.idempotency_key}` : "transition",
    from_status: from,
    to_status: input.to,
    detail: { reason: input.reason ?? null },
  });
  await audit(ctx, "contract_claim.transition", "contract_claims", input.claim_id, {
    from,
    to: input.to,
  });
  return {
    id: data.id as string,
    status: data.status as ClaimStatus,
    row_version: Number(data.row_version),
  };
}

export async function saveValuation(
  ctx: AuthContext,
  input: ClaimValuationInput,
): Promise<{ id: string }> {
  await requireWrite(ctx);
  const claim = await loadClaimRow(ctx, input.claim_id);
  const existing = await safeRows<{ valuation_no: number }>(() =>
    db(ctx)
      .from("contract_claim_valuations")
      .select("valuation_no")
      .eq("claim_id", input.claim_id)
      .eq("effective_period", input.effective_period)
      .order("valuation_no", { ascending: false })
      .limit(1),
  );
  const nextNo = (existing[0]?.valuation_no ?? 0) + 1;
  const fx = await resolveCostingFx(
    ctx,
    claim.project_id as string,
    claim.currency_code as string,
    input.effective_period,
  );
  const expected = Number(((input.amount * input.probability_pct) / 100).toFixed(2));
  const { data, error } = await db(ctx)
    .from("contract_claim_valuations")
    .insert({
      company_id: claim.company_id,
      project_id: claim.project_id,
      claim_id: input.claim_id,
      effective_period: input.effective_period,
      valuation_no: nextNo,
      basis: input.basis,
      currency_code: claim.currency_code,
      amount: input.amount,
      probability_pct: input.probability_pct,
      expected_amount: expected,
      fx_rate: fx.fx_rate,
      fx_rate_date: fx.fx_rate_date,
      fx_source: fx.fx_source,
      reason: input.reason,
      prepared_by: ctx.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id: claim.company_id,
    project_id: claim.project_id,
    claim_id: input.claim_id,
    entity_type: "valuation",
    entity_id: data.id,
    event_type: "valuation_recorded",
    detail: { basis: input.basis, amount: input.amount, valuation_no: nextNo },
  });
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------
/**
 * GC-16c — resolve the governed calendar/timezone for a deadline.
 *
 * Precedence: explicit request → contract policy → company costing policy.
 * There is no silent fallback: an unresolved or invalid configuration raises a
 * governed 422 so the operator fixes the policy instead of inheriting an
 * accidental Sat/Sun weekend on a MENA contract.
 */
export async function resolveDeadlineCalendar(
  ctx: AuthContext,
  companyId: string,
  input: {
    calendar_id?: string | undefined;
    timezone?: string | undefined;
    contract_id?: string | null | undefined;
  },
): Promise<{
  calendar: GovernedCalendar;
  calendar_id: string;
  calendar_version: string;
  calendar_source: "request" | "contract_policy" | "company_policy";
  timezone: string;
}> {
  let calendarId: string | null | undefined = input.calendar_id;
  let timezone: string | null | undefined = input.timezone;
  let source: "request" | "contract_policy" | "company_policy" = "request";

  if (!calendarId && input.contract_id) {
    const rows = await safeRows<{
      deadline_calendar_id: string | null;
      deadline_timezone: string | null;
    }>(() =>
      (ctx.supabase as never as AnySupabase)
        .from("contracts")
        .select("deadline_calendar_id, deadline_timezone")
        .eq("id", input.contract_id),
    );
    if (rows[0]?.deadline_calendar_id) {
      calendarId = rows[0].deadline_calendar_id;
      timezone = timezone ?? rows[0].deadline_timezone;
      source = "contract_policy";
    }
  }
  if (!calendarId) {
    const rows = await safeRows<{
      deadline_calendar_id: string | null;
      deadline_timezone: string | null;
    }>(() =>
      (ctx.supabase as never as AnySupabase)
        .from("costing_settings")
        .select("deadline_calendar_id, deadline_timezone")
        .eq("company_id", companyId),
    );
    if (rows[0]?.deadline_calendar_id) {
      calendarId = rows[0].deadline_calendar_id;
      timezone = timezone ?? rows[0].deadline_timezone;
      source = "company_policy";
    }
  }

  try {
    const calendar = resolveGovernedCalendar(calendarId);
    const tz = resolveGovernedTimezone(calendar, timezone ?? calendar.timezones[0]);
    return {
      calendar,
      calendar_id: calendar.id,
      calendar_version: calendar.version,
      calendar_source: source,
      timezone: tz,
    };
  } catch (err) {
    if (err instanceof CalendarConfigError) httpError(422, err.code, err.message);
    throw err;
  }
}

/** GC-16d — company switch that turns missing holiday-set coverage into a 422. */
async function holidaySetsEnforced(ctx: AuthContext, companyId: string): Promise<boolean> {
  const rows = await safeRows<{ holiday_sets_enforced: boolean | null }>(() =>
    (ctx.supabase as never as AnySupabase)
      .from("costing_settings")
      .select("holiday_sets_enforced")
      .eq("company_id", companyId),
  );
  return Boolean(rows[0]?.holiday_sets_enforced);
}



export async function saveDeadline(
  ctx: AuthContext,
  input: DeadlineInputSchema,
): Promise<{
  id: string;
  due_date: string;
  calendar_id: string;
  calendar_version: string;
  calendar_source: string;
  timezone: string;
}> {
  await requireWrite(ctx);
  const proj = await projectContext(ctx, input.project_id);
  const governed = await resolveDeadlineCalendar(ctx, proj.company_id, {
    calendar_id: input.calendar_id,
    timezone: input.timezone,
    contract_id: input.contract_id ?? null,
  });

  // GC-16d — fold the APPROVED observed-holiday set versions into the governed
  // base calendar. Missing coverage is a governed warning, or a hard 422 when
  // the company enforces holiday sets. There is never a silent fallback.
  const { loadEffectiveCalendar } = await import("@/lib/calendar-governance.server");
  const { checkHolidayCoverage, requiredHolidayYears } = await import(
    "@/lib/calendar-governance.rules"
  );
  const effective = await loadEffectiveCalendar(ctx, proj.company_id, governed.calendar_id);
  const coverage =
    input.calendar === "business"
      ? checkHolidayCoverage(
          effective,
          requiredHolidayYears(input.trigger_date, input.duration_days),
        )
      : { ok: true, missing_years: [] as number[], applied_versions: [] as string[], message: null };
  if (!coverage.ok) {
    const enforced = await holidaySetsEnforced(ctx, proj.company_id);
    if (enforced) httpError(422, "holiday_set_missing", coverage.message!);
  }

  const due = computeDueDate({
    kind: input.kind,
    trigger_date: input.trigger_date,
    duration_days: input.duration_days,
    calendar: input.calendar,
    workCalendar: effective,
  });
  const payload = {
    company_id: proj.company_id,
    project_id: input.project_id,
    contract_id: input.contract_id ?? null,
    claim_id: input.claim_id ?? null,
    kind: input.kind,
    label: input.label,
    clause_ref: input.clause_ref ?? null,
    trigger_date: input.trigger_date,
    duration_days: input.duration_days,
    calendar: input.calendar,
    calendar_id: governed.calendar_id,
    calendar_version: governed.calendar_version,
    calendar_source: governed.calendar_source,
    timezone: governed.timezone,
    holiday_set_versions: effective.holiday_set_versions,


    due_date: due,
    owner_id: input.owner_id ?? null,
    evidence_reference: input.evidence_reference ?? null,
    ...(input.status ? { status: input.status } : {}),
    ...(input.satisfied_at !== undefined ? { satisfied_at: input.satisfied_at } : {}),
  };
  if (!input.id) {
    const { data, error } = await db(ctx)
      .from("contract_deadlines")
      .insert({ ...payload, created_by: ctx.user?.id ?? null })
      .select("id, due_date")
      .single();
    if (error) throw error;
    await logEvent(ctx, {
      company_id: proj.company_id,
      project_id: input.project_id,
      claim_id: input.claim_id ?? null,
      entity_type: "deadline",
      entity_id: data.id,
      event_type: "deadline_created",
      detail: {
        kind: input.kind,
        due_date: due,
        calendar: input.calendar,
        calendar_id: governed.calendar_id,
        calendar_version: governed.calendar_version,
        calendar_source: governed.calendar_source,
        timezone: governed.timezone,
      },
    });
    return {
      id: data.id as string,
      due_date: data.due_date as string,
      calendar_id: governed.calendar_id,
      calendar_version: governed.calendar_version,
      calendar_source: governed.calendar_source,
      timezone: governed.timezone,
    };
  }
  const current = await safeRows<{ row_version: number; status: string }>(() =>
    db(ctx).from("contract_deadlines").select("row_version, status").eq("id", input.id).limit(1),
  );
  if (!current.length) httpError(404, "deadline_not_found", "Deadline not found.");
  if (input.row_version !== undefined && input.row_version !== current[0]!.row_version)
    httpError(409, "stale_write", "This deadline changed since it was loaded.");
  const { data, error } = await db(ctx)
    .from("contract_deadlines")
    .update(payload)
    .eq("id", input.id)
    .select("id, due_date")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id: proj.company_id,
    project_id: input.project_id,
    claim_id: input.claim_id ?? null,
    entity_type: "deadline",
    entity_id: input.id,
    event_type: "deadline_updated",
    detail: {
      kind: input.kind,
      due_date: data.due_date,
      calendar: input.calendar,
      calendar_id: governed.calendar_id,
      calendar_version: governed.calendar_version,
      calendar_source: governed.calendar_source,
      timezone: governed.timezone,
    },
  });
  return {
    id: data.id as string,
    due_date: data.due_date as string,
    calendar_id: governed.calendar_id,
    calendar_version: governed.calendar_version,
    calendar_source: governed.calendar_source,
    timezone: governed.timezone,
  };
}

// ---------------------------------------------------------------------------
// Basis gathering
// ---------------------------------------------------------------------------
async function loadClaims(ctx: AuthContext, projectId: string): Promise<ClaimRecord[]> {
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("contract_claims")
      .select("*")
      .eq("project_id", projectId)
      .order("claim_ref", { ascending: true }),
  );
  return rows.map((r) => ({
    id: r.id as string,
    claim_ref: r.claim_ref as string,
    title: r.title as string,
    kind: r.kind,
    status: r.status,
    currency_code: r.currency_code as string,
    clause_ref: r.clause_ref,
    entitlement_basis: r.entitlement_basis,
    cause: r.cause,
    effect: r.effect,
    mitigation: r.mitigation,
    is_back_to_back: Boolean(r.is_back_to_back),
    back_to_back_ref: r.back_to_back_ref,
    asserted_amount: n(r.asserted_amount),
    submitted_amount: n(r.submitted_amount),
    assessed_amount: n(r.assessed_amount),
    approved_amount: n(r.approved_amount),
    forecast_amount: n(r.forecast_amount),
    certified_amount: n(r.certified_amount),
    paid_amount: n(r.paid_amount),
    at_risk_amount: n(r.at_risk_amount),
    eot_days_claimed: n(r.eot_days_claimed),
    eot_days_assessed: n(r.eot_days_assessed),
    eot_days_approved: n(r.eot_days_approved),
    ld_exposure: n(r.ld_exposure),
    event_date: r.event_date,
    notice_due_at: r.notice_due_at,
    notice_served_at: r.notice_served_at,
    submission_due_at: r.submission_due_at,
    submitted_at: r.submitted_at,
    response_due_at: r.response_due_at,
    responded_at: r.responded_at,
    limitation_at: r.limitation_at,
    owner_id: r.owner_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

async function loadDeadlines(ctx: AuthContext, projectId: string): Promise<DeadlineRecord[]> {
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("contract_deadlines")
      .select(
        "id, claim_id, contract_id, kind, label, due_date, status, satisfied_at, owner_id, calendar, calendar_id, calendar_version, calendar_source, timezone, trigger_date, duration_days, row_version",
      )
      .eq("project_id", projectId)
      .order("due_date", { ascending: true }),
  );
  return rows as DeadlineRecord[];
}

async function loadInstruments(
  ctx: AuthContext,
  projectId: string,
): Promise<{ id: string; reference: string; expiry_date: string; kind: string }[]> {
  const rows = await safeRows<any>(() =>
    db(ctx)
      .from("bond_instruments")
      .select("id, bond_no, expiry_date, instrument_type, status")
      .eq("project_id", projectId),
  );
  return rows
    .filter((r) => r.expiry_date && r.status !== "released")
    .map((r) => ({
      id: r.id as string,
      reference: (r.bond_no as string) ?? r.id,
      expiry_date: (r.expiry_date as string).slice(0, 10),
      kind: (r.instrument_type as string) ?? "bond",
    }));
}

async function loadContractBasis(
  ctx: AuthContext,
  projectId: string,
): Promise<{ original_value: number; approved_variations: number; certified_to_date: number }> {
  const contracts = await safeRows<any>(() =>
    db(ctx).from("contracts").select("id, value, status").eq("project_id", projectId),
  );
  const cos = await safeRows<any>(() =>
    db(ctx).from("change_orders").select("amount, status").eq("project_id", projectId),
  );
  const original = contracts.reduce((s, c) => s + n(c.value), 0);
  const approved = cos
    .filter((c) => String(c.status) === "approved")
    .reduce((s, c) => s + n(c.amount), 0);
  return { original_value: original, approved_variations: approved, certified_to_date: 0 };
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
export interface ClaimsWorkspace {
  project: { id: string; name: string; currency: string };
  period_month: string;
  claims: Array<ClaimRecord & { exposure: ReturnType<typeof claimExposure> }>;
  deadlines: Array<DeadlineRecord & { state: ReturnType<typeof evaluateDeadline> }>;
  totals: ExposureTotals;
  waterfall: WaterfallStep[];
  contract_basis: {
    original_value: number;
    approved_variations: number;
    certified_to_date: number;
    remaining_value: number;
  };
  checks: ReconciliationCheck[];
  exceptions: ClaimException[];
  alerts: Array<JsonRecord>;
  snapshot: JsonRecord | null;
  timeline: Array<JsonRecord>;
  access: ClaimsAccess;
  disclaimer: string;
}

const monthOf = (iso: string): string => `${iso.slice(0, 7)}-01`;

export async function loadClaimsWorkspace(
  ctx: AuthContext,
  projectId: string,
  periodMonth?: string,
): Promise<ClaimsWorkspace> {
  const proj = await projectContext(ctx, projectId);
  const period = periodMonth ?? monthOf(todayIso());
  const [claims, deadlines, snapshotRows, alertRows, timeline, basis] = await Promise.all([
    loadClaims(ctx, projectId),
    loadDeadlines(ctx, projectId),
    safeRows<any>(() =>
      db(ctx)
        .from("contract_claim_snapshots")
        .select("*")
        .eq("project_id", projectId)
        .eq("period_month", period)
        .order("version_no", { ascending: false })
        .limit(1),
    ),
    safeRows<any>(() =>
      db(ctx)
        .from("contract_claim_alerts")
        .select("*")
        .eq("project_id", projectId)
        .order("severity", { ascending: false })
        .order("due_at", { ascending: true })
        .limit(200),
    ),
    safeRows<any>(() =>
      db(ctx)
        .from("contract_claim_events")
        .select("id, event_type, from_status, to_status, detail, occurred_at, actor_id, claim_id")
        .eq("project_id", projectId)
        .order("occurred_at", { ascending: false })
        .limit(100),
    ),
    loadContractBasis(ctx, projectId),
  ]);

  const totals = rollupClaims(claims);
  const checks = reconcile({
    totals,
    approved_variations_register: basis.approved_variations,
    forecast_claim_provision: totals.forecast,
  });
  const exceptions = deriveExceptions(claims, checks);
  const today = todayIso();
  const nowMs = Date.now();

  return {
    project: { id: projectId, name: proj.name, currency: proj.currency },
    period_month: period,
    claims: claims.map((c) => ({ ...c, exposure: claimExposure(c) })),
    // GC-16c: each deadline is evaluated against "today" in its own governed
    // timezone so DST/zone offsets never shift a contractual day.
    deadlines: deadlines.map((d) => ({
      ...d,
      state: evaluateDeadline(d, d.timezone ? zonedTodayIso(d.timezone, nowMs) : today),
    })),
    totals,
    waterfall: exposureWaterfall(totals),
    contract_basis: {
      ...basis,
      remaining_value: Number(
        (basis.original_value + basis.approved_variations - basis.certified_to_date).toFixed(2),
      ),
    },
    checks,
    exceptions,
    alerts: alertRows.map((a) => ({
      ...(a as JsonRecord),
      effective_state: effectiveAlertState(
        a as { state: AlertState; snoozed_until?: string },
        today,
      ),
    })) as JsonRecord[],
    snapshot: (snapshotRows[0] as JsonRecord) ?? null,
    timeline: timeline as unknown as JsonRecord[],
    access: await resolveClaimsAccess(ctx),
    disclaimer: CONTRACTS_CLAIMS_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Snapshot lifecycle
// ---------------------------------------------------------------------------
export async function buildClaimSnapshot(
  ctx: AuthContext,
  input: ClaimSnapshotBuildInput,
): Promise<{ snapshot_id: string; checksum: string; exceptions: ClaimException[] }> {
  await requireWrite(ctx);
  const proj = await projectContext(ctx, input.project_id);
  const reporting = (input.reporting_currency ?? proj.currency).toUpperCase();
  const claims = await loadClaims(ctx, input.project_id);
  const basis = await loadContractBasis(ctx, input.project_id);
  const totals = rollupClaims(claims);
  const checks = reconcile({
    totals,
    approved_variations_register: basis.approved_variations,
    forecast_claim_provision: totals.forecast,
  });
  const exceptions = deriveExceptions(claims, checks);

  const existing = await safeRows<any>(() =>
    db(ctx)
      .from("contract_claim_snapshots")
      .select("id, status, version_no, row_version")
      .eq("project_id", input.project_id)
      .eq("period_month", input.period_month)
      .neq("status", "superseded")
      .limit(1),
  );
  const prior = existing[0];
  if (prior && isFrozen(prior.status as SnapshotStatus))
    httpError(
      409,
      "snapshot_frozen",
      "The approved snapshot for this period must be superseded before a rebuild.",
    );

  const lines: JsonRecord[] = [];
  let sort = 0;
  const fxProvenance: JsonRecord = {};
  for (const c of claims) {
    const fx = await resolveCostingFx(ctx, input.project_id, c.currency_code, input.data_date);
    const e = claimExposure(c);
    fxProvenance[c.currency_code] = {
      rate: fx.fx_rate,
      rate_date: fx.fx_rate_date,
      source: fx.fx_source,
      stale: fx.stale,
    } as JsonRecord;
    lines.push({
      claim_id: c.id,
      label: `${c.claim_ref} — ${c.title}`,
      kind: c.kind,
      status: c.status,
      currency_code: c.currency_code,
      fx_rate: fx.fx_rate,
      fx_rate_date: fx.fx_rate_date,
      fx_source: fx.fx_source,
      fx_stale: fx.stale,
      asserted_amount: c.asserted_amount,
      submitted_amount: c.submitted_amount,
      assessed_amount: c.assessed_amount,
      approved_amount: c.approved_amount,
      forecast_amount: c.forecast_amount,
      certified_amount: c.certified_amount,
      paid_amount: c.paid_amount,
      at_risk_amount: c.at_risk_amount,
      exposure_amount: e.exposure,
      exposure_reporting: Number((e.exposure * (fx.fx_rate ?? 1)).toFixed(2)),
      eot_days_approved: c.eot_days_approved,
      sort_order: sort++,
    });
  }
  const checksum = snapshotChecksum(lines);

  let snapshotId: string;
  if (prior) {
    const { error } = await db(ctx)
      .from("contract_claim_snapshots")
      .update({
        data_date: input.data_date,
        totals: totals as unknown as JsonRecord,
        fx_provenance: fxProvenance,
        quality: { exceptions: exceptions.length, checks } as unknown as JsonRecord,
        checksum,
        reporting_currency: reporting,
        row_version: prior.row_version,
      })
      .eq("id", prior.id);
    if (error) throw error;
    snapshotId = prior.id as string;
    await db(ctx).from("contract_claim_snapshot_lines").delete().eq("snapshot_id", snapshotId);
  } else {
    const { data, error } = await db(ctx)
      .from("contract_claim_snapshots")
      .insert({
        company_id: proj.company_id,
        project_id: input.project_id,
        period_month: input.period_month,
        data_date: input.data_date,
        status: "working",
        reporting_currency: reporting,
        project_currency: proj.currency,
        totals: totals as unknown as JsonRecord,
        fx_provenance: fxProvenance,
        quality: { exceptions: exceptions.length, checks } as unknown as JsonRecord,
        checksum,
        prepared_by: ctx.user?.id ?? null,
        created_by: ctx.user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    snapshotId = data.id as string;
  }

  if (lines.length) {
    const { error } = await db(ctx)
      .from("contract_claim_snapshot_lines")
      .insert(lines.map((l) => ({ ...l, company_id: proj.company_id, snapshot_id: snapshotId })));
    if (error) throw error;
  }

  await logEvent(ctx, {
    company_id: proj.company_id,
    project_id: input.project_id,
    entity_type: "snapshot",
    entity_id: snapshotId,
    event_type: "snapshot_built",
    to_status: "working",
    detail: { checksum, lines: lines.length },
  });
  await persistAlerts(ctx, proj.company_id, input.project_id, claims, exceptions);
  return { snapshot_id: snapshotId, checksum, exceptions };
}

export async function transitionClaimSnapshot(
  ctx: AuthContext,
  input: ClaimSnapshotTransitionInput,
): Promise<{ id: string; status: SnapshotStatus; row_version: number }> {
  const rows = await safeRows<any>(() =>
    db(ctx).from("contract_claim_snapshots").select("*").eq("id", input.snapshot_id).limit(1),
  );
  const snap = rows[0];
  if (!snap) httpError(404, "snapshot_not_found", "Snapshot not found.");
  if (snap.row_version !== input.row_version)
    httpError(409, "stale_write", "This snapshot changed since it was loaded.");
  const from = snap.status as SnapshotStatus;
  if (!canTransitionSnapshot(from, input.to))
    httpError(422, "invalid_transition", `A snapshot cannot move from ${from} to ${input.to}.`);
  if (input.to === "approved") {
    await requireApprove(ctx);
    if (snap.submitted_by && snap.submitted_by === ctx.user?.id)
      httpError(403, "segregation_of_duties", "The submitter of a snapshot cannot approve it.");
    const quality = (snap.quality ?? {}) as { checks?: ReconciliationCheck[] };
    const blockers = approvalBlockers(
      deriveExceptions([], (quality.checks ?? []) as ReconciliationCheck[]),
    );
    if (blockers.length)
      httpError(422, "approval_blocked", `Unresolved critical exceptions: ${blockers.join(", ")}`);
  } else await requireWrite(ctx);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.to, row_version: snap.row_version };
  if (input.to === "submitted") {
    patch.submitted_by = ctx.user?.id ?? null;
    patch.submitted_at = now;
  }
  if (input.to === "approved") {
    patch.approved_by = ctx.user?.id ?? null;
    patch.approved_at = now;
  }
  if (input.to === "superseded") {
    patch.superseded_at = now;
    patch.correction_reason = input.reason ?? null;
  }
  const { data, error } = await db(ctx)
    .from("contract_claim_snapshots")
    .update(patch)
    .eq("id", input.snapshot_id)
    .select("id, status, row_version")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id: snap.company_id,
    project_id: snap.project_id,
    entity_type: "snapshot",
    entity_id: input.snapshot_id,
    event_type: "snapshot_transition",
    from_status: from,
    to_status: input.to,
    detail: { reason: input.reason ?? null },
  });
  await audit(
    ctx,
    "contract_claim_snapshot.transition",
    "contract_claim_snapshots",
    input.snapshot_id,
    {
      from,
      to: input.to,
    },
  );
  return {
    id: data.id as string,
    status: data.status as SnapshotStatus,
    row_version: Number(data.row_version),
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
async function persistAlerts(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  claims: readonly ClaimRecord[],
  exceptions: readonly ClaimException[],
): Promise<ClaimAlert[]> {
  const [deadlines, instruments] = await Promise.all([
    loadDeadlines(ctx, projectId),
    loadInstruments(ctx, projectId),
  ]);
  const priorLines = await safeRows<any>(() =>
    db(ctx)
      .from("contract_claim_snapshot_lines")
      .select("claim_id, approved_amount")
      .in("claim_id", claims.map((c) => c.id).slice(0, 500)),
  );
  const priorApproved: Record<string, number> = {};
  for (const l of priorLines)
    if (l.claim_id) priorApproved[l.claim_id as string] = n(l.approved_amount);

  const alerts = evaluateClaimAlerts({
    project_id: projectId,
    today: todayIso(),
    claims,
    deadlines,
    exceptions,
    instruments,
    priorApproved,
    nowMs: Date.now(),
  });

  for (const a of alerts) {
    const { error } = await db(ctx).from("contract_claim_alerts").upsert(
      {
        company_id: companyId,
        project_id: projectId,
        claim_id: a.claim_id,
        deadline_id: a.deadline_id,
        dedupe_key: a.dedupe_key,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        message: a.message,
        owner_id: a.owner_id,
        due_at: a.due_at,
        evidence_link: a.evidence_link,
        context: a.context,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "company_id,dedupe_key", ignoreDuplicates: false },
    );
    if (error) throw error;
  }
  return alerts;
}

export async function actOnAlert(
  ctx: AuthContext,
  input: ClaimAlertActionInput,
): Promise<{ id: string; state: AlertState }> {
  await requireWrite(ctx);
  const rows = await safeRows<any>(() =>
    db(ctx).from("contract_claim_alerts").select("*").eq("id", input.alert_id).limit(1),
  );
  const alert = rows[0];
  if (!alert) httpError(404, "alert_not_found", "Alert not found.");
  const now = new Date().toISOString();

  if (input.action === "assign") {
    const { error } = await db(ctx)
      .from("contract_claim_alerts")
      .update({ owner_id: input.owner_id ?? null })
      .eq("id", input.alert_id);
    if (error) throw error;
    return { id: input.alert_id, state: alert.state as AlertState };
  }

  const to = alertActionToState(input.action);
  if (!to) httpError(422, "invalid_action", "Unsupported alert action.");
  const from = effectiveAlertState(
    alert as { state: AlertState; snoozed_until?: string },
    todayIso(),
  );
  if (!canTransitionAlert(from, to))
    httpError(422, "invalid_transition", `An alert cannot move from ${from} to ${to}.`);

  const patch: Record<string, unknown> = { state: to, row_version: alert.row_version };
  if (to === "acknowledged") {
    patch.acknowledged_by = ctx.user?.id ?? null;
    patch.acknowledged_at = now;
  }
  if (to === "snoozed") {
    if (!input.snoozed_until) httpError(422, "snooze_date_required", "A snooze date is required.");
    patch.snoozed_until = input.snoozed_until;
  }
  if (to === "escalated") patch.escalated_at = now;
  if (to === "resolved") {
    patch.resolved_by = ctx.user?.id ?? null;
    patch.resolved_at = now;
  }
  if (to === "open" && from === "resolved") {
    patch.reopened_at = now;
    patch.resolved_at = null;
    patch.resolved_by = null;
  }

  const { error } = await db(ctx)
    .from("contract_claim_alerts")
    .update(patch)
    .eq("id", input.alert_id);
  if (error) throw error;
  await logEvent(ctx, {
    company_id: alert.company_id,
    project_id: alert.project_id,
    claim_id: alert.claim_id,
    entity_type: "alert",
    entity_id: input.alert_id,
    event_type: `alert_${input.action}`,
    from_status: from,
    to_status: to,
    detail: { note: input.note ?? null },
  });
  return { id: input.alert_id, state: to };
}

export async function refreshProjectAlerts(
  ctx: AuthContext,
  projectId: string,
): Promise<{ evaluated: number }> {
  await requireWrite(ctx);
  const proj = await projectContext(ctx, projectId);
  const claims = await loadClaims(ctx, projectId);
  const basis = await loadContractBasis(ctx, projectId);
  const totals = rollupClaims(claims);
  const exceptions = deriveExceptions(
    claims,
    reconcile({
      totals,
      approved_variations_register: basis.approved_variations,
      forecast_claim_provision: totals.forecast,
    }),
  );
  const alerts = await persistAlerts(ctx, proj.company_id, projectId, claims, exceptions);
  return { evaluated: alerts.length };
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
export interface PortfolioClaimsView {
  period_month: string;
  projects: PortfolioProjectExposure[];
  totals: ReturnType<typeof rollupPortfolio>;
  concentration: ReturnType<typeof concentrationBy>;
  waterfall: WaterfallStep[];
  alerts: Array<JsonRecord>;
  access: ClaimsAccess;
  disclaimer: string;
}

export async function loadPortfolioClaims(
  ctx: AuthContext,
  query: PortfolioClaimsQuery,
): Promise<PortfolioClaimsView> {
  const period = query.period_month ?? monthOf(todayIso());
  const projects = await safeRows<any>(() =>
    db(ctx).from("projects").select("id, name, status").order("name", { ascending: true }),
  );
  const filtered = query.search
    ? projects.filter((p) => String(p.name).toLowerCase().includes(query.search!.toLowerCase()))
    : projects;

  const claimRows = await safeRows<any>(() => db(ctx).from("contract_claims").select("*"));
  const deadlineRows = await safeRows<any>(() =>
    db(ctx)
      .from("contract_deadlines")
      .select("project_id, due_date, status, satisfied_at, timezone"),
  );
  const alertRows = await safeRows<any>(() =>
    db(ctx)
      .from("contract_claim_alerts")
      .select("*")
      .neq("state", "resolved")
      .order("severity", { ascending: false })
      .limit(300),
  );
  const today = todayIso();
  const portfolioNowMs = Date.now();

  const rows: PortfolioProjectExposure[] = filtered
    .map((p) => {
      const claims = claimRows
        .filter((c) => c.project_id === p.id)
        .map((r) => ({
          id: r.id,
          claim_ref: r.claim_ref,
          title: r.title,
          kind: r.kind,
          status: r.status,
          currency_code: r.currency_code,
          clause_ref: r.clause_ref,
          entitlement_basis: r.entitlement_basis,
          asserted_amount: n(r.asserted_amount),
          submitted_amount: n(r.submitted_amount),
          assessed_amount: n(r.assessed_amount),
          approved_amount: n(r.approved_amount),
          forecast_amount: n(r.forecast_amount),
          certified_amount: n(r.certified_amount),
          paid_amount: n(r.paid_amount),
          at_risk_amount: n(r.at_risk_amount),
          eot_days_claimed: n(r.eot_days_claimed),
          eot_days_assessed: n(r.eot_days_assessed),
          eot_days_approved: n(r.eot_days_approved),
          ld_exposure: n(r.ld_exposure),
        })) as ClaimRecord[];
      const overdue = deadlineRows.filter(
        (d) =>
          d.project_id === p.id &&
          evaluateDeadline(
            d as DeadlineRecord & { due_date: string },
            d.timezone ? zonedTodayIso(String(d.timezone), portfolioNowMs) : today,
          ).overdue,
      ).length;
      return {
        project_id: p.id as string,
        project_name: p.name as string,
        currency: "USD",
        totals: rollupClaims(claims),
        open_alerts: alertRows.filter((a) => a.project_id === p.id).length,
        overdue_deadlines: overdue,
      };
    })
    .filter((r) => r.totals.claim_count > 0 || r.open_alerts > 0);

  const totals = rollupPortfolio(rows);
  return {
    period_month: period,
    projects: rows,
    totals,
    concentration: concentrationBy(rows),
    waterfall: exposureWaterfall(totals),
    alerts: alertRows.map((a) => ({
      ...(a as JsonRecord),
      effective_state: effectiveAlertState(
        a as { state: AlertState; snoozed_until?: string },
        today,
      ),
    })) as JsonRecord[],
    access: await resolveClaimsAccess(ctx),
    disclaimer: CONTRACTS_CLAIMS_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Pack appendix
// ---------------------------------------------------------------------------
export interface ClaimsAppendix {
  project_id: string;
  project_name: string;
  period_month: string;
  status: SnapshotStatus | "none";
  totals: ExposureTotals;
  waterfall: WaterfallStep[];
  top_claims: Array<{
    claim_ref: string;
    title: string;
    status: ClaimStatus;
    currency_code: string;
    approved_amount: number;
    exposure: number;
  }>;
  upcoming_deadlines: Array<{
    label: string;
    kind: string;
    due_date: string;
    days: number;
    calendar: string;
    calendar_id: string;
    calendar_version: string;
    timezone: string;
  }>;
  open_alerts: Array<{ kind: string; severity: string; title: string; due_at: string | null }>;
  checks: ReconciliationCheck[];
  disclaimer: string;
}

export async function loadClaimsAppendix(
  ctx: AuthContext,
  projectId: string,
  periodMonth?: string,
): Promise<ClaimsAppendix> {
  const ws = await loadClaimsWorkspace(ctx, projectId, periodMonth);
  const today = todayIso();
  return {
    project_id: projectId,
    project_name: ws.project.name,
    period_month: ws.period_month,
    status: ((ws.snapshot?.["status"] as SnapshotStatus) ?? "none") as SnapshotStatus | "none",
    totals: ws.totals,
    waterfall: ws.waterfall,
    top_claims: [...ws.claims]
      .sort((a, b) => b.exposure.exposure - a.exposure.exposure)
      .slice(0, 10)
      .map((c) => ({
        claim_ref: c.claim_ref,
        title: c.title,
        status: c.status,
        currency_code: c.currency_code,
        approved_amount: c.approved_amount,
        exposure: c.exposure.exposure,
      })),
    upcoming_deadlines: ws.deadlines
      .filter((d) => d.state.status === "open")
      .slice(0, 10)
      .map((d) => ({
        label: d.label,
        kind: d.kind,
        due_date: d.due_date,
        days: d.state.days_remaining,
        calendar: d.calendar ?? "calendar",
        calendar_id: d.calendar_id ?? "",
        calendar_version: d.calendar_version ?? "",
        timezone: d.timezone ?? "",
      })),
    open_alerts: (ws.alerts as JsonRecord[])
      .filter((a) => a["effective_state"] !== "resolved")
      .slice(0, 20)
      .map((a) => ({
        kind: String(a["kind"]),
        severity: String(a["severity"]),
        title: String(a["title"]),
        due_at: (a["due_at"] as string | null) ?? null,
      })),
    checks: ws.checks,
    disclaimer: `${CONTRACTS_CLAIMS_DISCLAIMER} Prepared ${today}.`,
  };
}
