// P-202 — Bonds & guarantees I/O helpers (kept out of *.functions.ts).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { safeRows } from "@/lib/finance-cockpit.server";
import { httpError } from "@/lib/payments.server";
import {
  BOND_WRITE_ROLES,
  daysToExpiry,
  effectiveStatus,
  type BondRow,
  type BondStatus,
  type CreateBondInput,
  type CreateClaimInput,
  type ListBondsInput,
} from "@/lib/bonds.rules";
import { hasAnyRole } from "@/lib/payments.server";

export const BONDS_BUCKET = "documents";

export async function bondsCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id ?? null;
  if (!companyId) httpError(400, "no_company", "No active company context.");
  return companyId;
}

export async function canWriteBonds(ctx: AuthContext): Promise<boolean> {
  return hasAnyRole(ctx, BOND_WRITE_ROLES);
}

export async function assertBondWrite(ctx: AuthContext): Promise<void> {
  if (!(await canWriteBonds(ctx))) {
    httpError(
      403,
      "forbidden",
      "Only finance, legal or company admins can manage bonds and guarantees.",
    );
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RawBond {
  id: string;
  instrument_number: string;
  instrument_type: string;
  beneficiary_name: string;
  beneficiary_type: string;
  issuer_name: string;
  issuer_type: string;
  principal_name: string | null;
  project_id: string | null;
  contract_id: string | null;
  amount: number | string | null;
  currency_code: string;
  premium_pct: number | string | null;
  issue_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  status: BondStatus;
  auto_renew: boolean | null;
  document_path: string | null;
  notes: string | null;
  created_at: string;
}

function toRow(raw: RawBond, projectNames: Map<string, string>, today: string): BondRow {
  const days = daysToExpiry(raw.expiry_date, today);
  return {
    id: raw.id,
    instrument_number: raw.instrument_number,
    instrument_type: raw.instrument_type as BondRow["instrument_type"],
    beneficiary_name: raw.beneficiary_name,
    beneficiary_type: raw.beneficiary_type as BondRow["beneficiary_type"],
    issuer_name: raw.issuer_name,
    issuer_type: raw.issuer_type as BondRow["issuer_type"],
    principal_name: raw.principal_name,
    project_id: raw.project_id,
    project_name: raw.project_id ? (projectNames.get(raw.project_id) ?? null) : null,
    contract_id: raw.contract_id,
    amount: Number(raw.amount ?? 0),
    currency_code: raw.currency_code,
    premium_pct: raw.premium_pct === null ? null : Number(raw.premium_pct),
    issue_date: raw.issue_date,
    effective_date: raw.effective_date,
    expiry_date: raw.expiry_date,
    status: raw.status,
    effective_status: effectiveStatus(raw.status, days),
    days_to_expiry: days,
    auto_renew: Boolean(raw.auto_renew),
    document_path: raw.document_path,
    notes: raw.notes,
    created_at: raw.created_at,
  };
}

export async function loadProjectNames(ctx: AuthContext): Promise<Map<string, string>> {
  const rows =
    (await safeRows<{ id: string; name: string | null }>(() =>
      ctx.supabase.from("projects").select("id, name").order("name"),
    )) ?? [];
  return new Map(rows.map((r) => [r.id, r.name ?? "Untitled project"]));
}

export async function queryBonds(ctx: AuthContext, filters: ListBondsInput): Promise<BondRow[]> {
  const today = todayIso();
  const projectNames = await loadProjectNames(ctx);
  const rows =
    (await safeRows<RawBond>(() => {
      let q = ctx.supabase
        .from("bond_instruments")
        .select(
          "id, instrument_number, instrument_type, beneficiary_name, beneficiary_type, issuer_name, issuer_type, principal_name, project_id, contract_id, amount, currency_code, premium_pct, issue_date, effective_date, expiry_date, status, auto_renew, document_path, notes, created_at",
        )
        .order("created_at", { ascending: false });
      if (filters.instrument_type) q = q.eq("instrument_type", filters.instrument_type as never);
      if (filters.project_id) q = q.eq("project_id", filters.project_id);
      if (filters.issuer) q = q.ilike("issuer_name", `%${filters.issuer}%`);
      return q;
    })) ?? [];

  let mapped = rows.map((r) => toRow(r, projectNames, today));
  // Status filter runs on the effective (computed) status so the UI and the
  // filter agree; the cron materializes the same values in P-203.
  if (filters.status) mapped = mapped.filter((r) => r.effective_status === filters.status);
  return mapped;
}

export async function outstandingClaimCount(ctx: AuthContext): Promise<number> {
  const rows =
    (await safeRows<{ id: string }>(() =>
      ctx.supabase.from("bond_claims").select("id").in("status", ["submitted", "contested"]),
    )) ?? [];
  return rows.length;
}

export async function loadCurrencies(ctx: AuthContext): Promise<string[]> {
  const rows =
    (await safeRows<{ code: string }>(() =>
      ctx.supabase.from("currencies").select("code").order("code"),
    )) ?? [];
  return rows.map((r) => r.code);
}

export async function loadContracts(
  ctx: AuthContext,
): Promise<{ id: string; label: string; project_id: string | null }[]> {
  const rows =
    (await safeRows<{
      id: string;
      contract_number: string | null;
      title: string | null;
      project_id: string | null;
    }>(() =>
      ctx.supabase
        .from("contracts")
        .select("id, contract_number, title, project_id")
        .order("created_at", { ascending: false }),
    )) ?? [];
  return rows.map((r) => ({
    id: r.id,
    label: [r.contract_number, r.title].filter(Boolean).join(" — ") || "Contract",
    project_id: r.project_id,
  }));
}

export async function loadBond(ctx: AuthContext, id: string): Promise<BondRow> {
  const rows = await queryBonds(ctx, {});
  const row = rows.find((r) => r.id === id);
  if (!row) httpError(404, "bond_not_found", "Instrument not found.");
  return row;
}

export async function insertBond(
  ctx: AuthContext,
  companyId: string,
  data: CreateBondInput,
): Promise<BondRow> {
  const payload = {
    company_id: companyId,
    instrument_type: data.instrument_type,
    beneficiary_name: data.beneficiary_name,
    beneficiary_type: data.beneficiary_type,
    issuer_name: data.issuer_name,
    issuer_type: data.issuer_type,
    principal_name: data.principal_name ?? null,
    project_id: data.project_id ?? null,
    contract_id: data.contract_id ?? null,
    amount: data.amount,
    currency_code: data.currency_code,
    premium_pct: data.premium_pct ?? null,
    issue_date: data.issue_date,
    effective_date: data.effective_date ?? null,
    expiry_date: data.expiry_date ?? null,
    auto_renew: data.auto_renew,
    notes: data.notes ?? null,
    status: "draft" as const,
    created_by: ctx.user!.id,
  };
  const { data: inserted, error } = await ctx.supabase
    .from("bond_instruments")
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  return loadBond(ctx, (inserted as { id: string }).id);
}

export async function setBondStatus(
  ctx: AuthContext,
  id: string,
  status: BondStatus,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("bond_instruments")
    .update({ status } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function setBondDocument(
  ctx: AuthContext,
  id: string,
  path: string | null,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("bond_instruments")
    .update({ document_path: path } as never)
    .eq("id", id);
  if (error) throw error;
}

export interface RenewalRow {
  id: string;
  previous_expiry: string | null;
  new_expiry: string | null;
  renewed_at: string | null;
  renewed_by: string | null;
  renewed_by_name: string | null;
  premium_amount: number | null;
  notes: string | null;
  document_path: string | null;
  document_url?: string | null;
}

/** Display names for actor ids (renewals timeline). */
export async function loadActorNames(
  ctx: AuthContext,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows =
    (await safeRows<{ id: string; full_name: string | null; email: string | null }>(() =>
      ctx.supabase.from("profiles").select("id, full_name, email").in("id", unique),
    )) ?? [];
  return new Map(rows.map((r) => [r.id, r.full_name || r.email || "Unknown user"]));
}

export async function loadRenewals(ctx: AuthContext, instrumentId: string): Promise<RenewalRow[]> {
  const rows =
    (await safeRows<
      Omit<RenewalRow, "premium_amount" | "renewed_by_name"> & {
        premium_amount: number | string | null;
      }
    >(() =>
      ctx.supabase
        .from("bond_renewals")
        .select(
          "id, previous_expiry, new_expiry, renewed_at, renewed_by, premium_amount, notes, document_path",
        )
        .eq("instrument_id", instrumentId)
        .order("renewed_at", { ascending: false }),
    )) ?? [];
  const names = await loadActorNames(
    ctx,
    rows.map((r) => r.renewed_by ?? ""),
  );
  return rows.map((r) => ({
    ...r,
    renewed_by_name: r.renewed_by ? (names.get(r.renewed_by) ?? null) : null,
    premium_amount: r.premium_amount === null ? null : Number(r.premium_amount),
  }));
}

/** Renewal history rows are insert-only — no update/delete helper exists. */
export async function insertRenewal(
  ctx: AuthContext,
  companyId: string,
  data: {
    instrument_id: string;
    previous_expiry: string | null;
    new_expiry: string;
    premium_amount?: number;
    document_path?: string;
    notes?: string;
  },
): Promise<void> {
  const { error } = await ctx.supabase.from("bond_renewals").insert({
    company_id: companyId,
    instrument_id: data.instrument_id,
    previous_expiry: data.previous_expiry,
    new_expiry: data.new_expiry,
    premium_amount: data.premium_amount ?? null,
    document_path: data.document_path ?? null,
    notes: data.notes ?? null,
    renewed_by: ctx.user!.id,
  } as never);
  if (error) throw error;
}

export interface ClaimRow {
  id: string;
  claim_number: string | null;
  claim_date: string | null;
  amount: number;
  currency_code: string | null;
  reason: string | null;
  status: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  submitted_by: string | null;
  instrument_id?: string;
}

export async function loadClaims(ctx: AuthContext, instrumentId: string): Promise<ClaimRow[]> {
  const rows =
    (await safeRows<Omit<ClaimRow, "amount"> & { amount: number | string | null }>(() =>
      ctx.supabase
        .from("bond_claims")
        .select(
          "id, claim_number, claim_date, amount, currency_code, reason, status, resolved_at, resolution_notes, submitted_by",
        )
        .eq("instrument_id", instrumentId)
        .order("claim_date", { ascending: true }),
    )) ?? [];
  return rows.map((r) => ({ ...r, amount: Number(r.amount ?? 0) }));
}

export interface TimelineEvent {
  at: string;
  label: string;
  detail: string | null;
}

export async function loadTimeline(
  ctx: AuthContext,
  instrumentId: string,
  renewals: RenewalRow[],
  claims: ClaimRow[],
): Promise<TimelineEvent[]> {
  const audits =
    (await safeRows<{ action: string; created_at: string; metadata: unknown }>(() =>
      ctx.supabase
        .from("audit_logs")
        .select("action, created_at, metadata")
        .eq("entity_id", instrumentId)
        .order("created_at", { ascending: true }),
    )) ?? [];

  const events: TimelineEvent[] = audits.map((a) => ({
    at: a.created_at,
    label: a.action,
    detail: null,
  }));
  for (const r of renewals) {
    events.push({
      at: r.renewed_at ?? r.new_expiry ?? "",
      label: "bond.renewed",
      detail: `${r.previous_expiry ?? "—"} → ${r.new_expiry ?? "—"}`,
    });
  }
  for (const c of claims) {
    events.push({
      at: c.claim_date ?? "",
      label: `claim.${c.status}`,
      detail: `${c.claim_number}`,
    });
  }
  return events.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at));
}

export function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// P-204 — claims + release/return/cancel I/O
// ---------------------------------------------------------------------------

export interface ClaimRecord extends ClaimRow {
  instrument_id: string;
}

export async function loadClaim(ctx: AuthContext, claimId: string): Promise<ClaimRecord> {
  const { data, error } = await ctx.supabase
    .from("bond_claims")
    .select(
      "id, instrument_id, claim_number, claim_date, amount, currency_code, reason, status, resolved_at, resolution_notes, submitted_by",
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "claim_not_found", "Claim not found.");
  const raw = data as ClaimRecord & { amount: number | string | null };
  return { ...raw, amount: Number(raw.amount ?? 0) };
}

export async function insertClaim(
  ctx: AuthContext,
  companyId: string,
  data: CreateClaimInput,
): Promise<ClaimRecord> {
  const { data: inserted, error } = await ctx.supabase
    .from("bond_claims")
    .insert({
      company_id: companyId,
      instrument_id: data.instrument_id,
      amount: data.amount,
      currency_code: data.currency_code,
      reason: data.reason,
      claim_date: data.claim_date,
      status: "draft",
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return loadClaim(ctx, (inserted as { id: string }).id);
}

export async function updateClaim(
  ctx: AuthContext,
  claimId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("bond_claims")
    .update(patch as never)
    .eq("id", claimId);
  if (error) throw error;
}

/** Terminal/lifecycle patch on the instrument (status + reason + release stamps). */
export async function patchBond(
  ctx: AuthContext,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.supabase
    .from("bond_instruments")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

/** P-111 approval start. Returns the instance id, or null when no rule exists. */
export async function startBondRelease(
  ctx: AuthContext,
  instrumentId: string,
  amount: number,
  reason: string,
): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc("start_approval_instance", {
    p_rule_key: "bond_release",
    p_entity_type: "bond_instrument",
    p_entity_id: instrumentId,
    p_amount: amount,
    p_metadata: { reason } as never,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

export interface ReleaseApproval {
  id: string;
  status: string;
  current_step: number;
  reason: string | null;
  requested_at: string | null;
}

/** Latest bond_release approval instance for an instrument (null when none). */
export async function latestReleaseApproval(
  ctx: AuthContext,
  instrumentId: string,
): Promise<ReleaseApproval | null> {
  const rows =
    (await safeRows<ReleaseApproval>(() =>
      ctx.supabase
        .from("approval_instances")
        .select("id, status, current_step, metadata, requested_at")
        .eq("entity_type", "bond_instrument")
        .eq("entity_id", instrumentId)
        .order("created_at", { ascending: false })
        .limit(1),
    )) ?? [];
  const row = rows[0] as (ReleaseApproval & { metadata?: unknown }) | undefined;
  if (!row) return null;
  const meta = (row.metadata ?? null) as { reason?: unknown } | null;
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    reason: typeof meta?.reason === "string" ? meta.reason : null,
    requested_at: row.requested_at,
  };
}
