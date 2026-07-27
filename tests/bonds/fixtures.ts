// P-206 — Typed, overridable fixtures + offline harnesses for the bond suite.
//
// No network, no Supabase: instruments/claims are plain objects and the two
// stateful harnesses (expiry cron, release approval chain) are in-memory
// mirrors of the shipped server behaviour driven by the same pure helpers.

import {
  BOND_THRESHOLDS,
  bondDaysToExpiry,
  bondFingerprint,
  bondStatusForDays,
  rolesForThreshold,
} from "@/lib/finance/bond-expiry";
import type { GuardClaim, GuardInstrument } from "@/lib/bonds.guards";
import {
  daysToExpiry,
  effectiveStatus,
  type BondStatus,
  type ClaimStatus,
} from "@/lib/bonds.rules";

export const TODAY = "2026-07-27";

export interface InstrumentFixture extends GuardInstrument {
  id: string;
  company_id: string;
  instrument_number: string;
  currency_code: string;
  status: BondStatus;
  effective_status: BondStatus;
}

/** Instrument factory — every field overridable; effective_status derived. */
export function makeInstrument(
  overrides: Partial<InstrumentFixture> = {},
  today = TODAY,
): InstrumentFixture {
  const base = {
    id: "bond-1",
    company_id: "company-a",
    instrument_number: "BG-0001",
    instrument_type: "performance_bond",
    amount: 100_000,
    currency_code: "USD",
    issue_date: "2026-01-01",
    effective_date: "2026-01-01",
    expiry_date: "2027-01-01",
    document_path: "company-a/bonds/bond-1/guarantee.pdf",
    status: "active" as BondStatus,
    ...overrides,
  };
  const days = daysToExpiry(base.expiry_date, today);
  return {
    ...base,
    effective_status: overrides.effective_status ?? effectiveStatus(base.status, days),
  };
}

export interface ClaimFixture extends GuardClaim {
  instrument_id: string;
  status: ClaimStatus;
  currency_code: string;
}

export function makeClaim(overrides: Partial<ClaimFixture> = {}): ClaimFixture {
  return {
    id: "claim-1",
    instrument_id: "bond-1",
    amount: 10_000,
    currency_code: "USD",
    status: "draft",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Expiry cron harness — mirrors src/routes/api/cron/bond-expiry.ts
// ---------------------------------------------------------------------------

export interface ExpiryRunResult {
  /** Only instruments whose stored status actually changes (idempotent set). */
  updates: Array<{ id: string; status: string }>;
  /** Notifications keyed by fingerprint `<id>:<threshold>`. */
  notices: Array<{
    fingerprint: string;
    instrument_id: string;
    threshold: number;
    roles: string[];
  }>;
}

/** Runs one expiry pass over instruments, deduping against sent fingerprints. */
export function runExpiryPass(
  instruments: InstrumentFixture[],
  today: string,
  sentFingerprints: Set<string> = new Set(),
): ExpiryRunResult {
  const result: ExpiryRunResult = { updates: [], notices: [] };
  for (const row of instruments) {
    const days = bondDaysToExpiry(row.expiry_date, today);
    const target = bondStatusForDays(days);
    // Null expiry → no transition at all.
    if (target === null) continue;
    // Terminal / claimed instruments are never re-materialized by the cron.
    if (!["active", "expiring_soon", "expired"].includes(row.status)) continue;
    if (row.status !== target) {
      result.updates.push({ id: row.id, status: target });
      row.status = target as BondStatus;
    }
    for (const threshold of BOND_THRESHOLDS) {
      if (days === null || days < 0 || days > threshold) continue;
      const fingerprint = bondFingerprint(row.id, threshold);
      if (sentFingerprints.has(fingerprint)) continue;
      sentFingerprints.add(fingerprint);
      result.notices.push({
        fingerprint,
        instrument_id: row.id,
        threshold,
        roles: [...rolesForThreshold(threshold)],
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Release approval chain harness — mirrors the 0083 seeded bond_release rule
// ---------------------------------------------------------------------------

export const BOND_RELEASE_CHAIN = [
  { step_order: 1, role: "finance_admin" },
  { step_order: 2, role: "legal_admin" },
] as const;

export interface ApprovalRow {
  step_order: number;
  role: string;
  decision: "pending" | "approved" | "rejected";
  decided_by: string | null;
}

export interface ReleaseInstance {
  id: string;
  instrument_id: string;
  requested_by: string;
  current_step: number;
  status: "pending" | "approved" | "rejected";
  approvals: ApprovalRow[];
}

export interface ReleaseWorld {
  instrument: InstrumentFixture;
  instance: ReleaseInstance | null;
  audits: Array<{ action: string; instrument_id: string }>;
  roleHolders: Record<string, string[]>;
}

export function makeReleaseWorld(overrides: Partial<ReleaseWorld> = {}): ReleaseWorld {
  return {
    instrument: makeInstrument(),
    instance: null,
    audits: [],
    roleHolders: {
      finance_admin: ["user-fin"],
      legal_admin: ["user-legal"],
      company_admin: ["user-admin"],
    },
    ...overrides,
  };
}

/** start_approval_instance('bond_release', …) — step 1 rows only. */
export function startRelease(
  world: ReleaseWorld,
  requestedBy: string,
  ruleSeeded = true,
): ReleaseInstance | null {
  if (!ruleSeeded) return null;
  world.instance = {
    id: "appr-1",
    instrument_id: world.instrument.id,
    requested_by: requestedBy,
    current_step: 1,
    status: "pending",
    approvals: world.roleHolders.finance_admin.map(() => ({
      step_order: 1,
      role: "finance_admin",
      decision: "pending" as const,
      decided_by: null,
    })),
  };
  world.audits.push({ action: "bond.release_requested", instrument_id: world.instrument.id });
  return world.instance;
}

/** decide_approval — advances the chain, never lets the requester self-approve. */
export function decideRelease(
  world: ReleaseWorld,
  actor: string,
  decision: "approved" | "rejected",
): { ok: boolean; error?: string } {
  const inst = world.instance;
  if (!inst || inst.status !== "pending") return { ok: false, error: "no_pending_instance" };
  const step = BOND_RELEASE_CHAIN.find((s) => s.step_order === inst.current_step)!;
  if (!world.roleHolders[step.role]?.includes(actor)) return { ok: false, error: "wrong_role" };
  if (actor === inst.requested_by) return { ok: false, error: "self_approval" };
  for (const a of inst.approvals.filter((a) => a.step_order === inst.current_step)) {
    a.decision = decision;
    a.decided_by = actor;
  }
  if (decision === "rejected") {
    inst.status = "rejected";
    world.audits.push({ action: "bond.release_rejected", instrument_id: world.instrument.id });
    return { ok: true };
  }
  const next = BOND_RELEASE_CHAIN.find((s) => s.step_order === inst.current_step + 1);
  if (next) {
    inst.current_step = next.step_order;
    inst.approvals.push(
      ...(world.roleHolders[next.role] ?? []).map(() => ({
        step_order: next.step_order,
        role: next.role,
        decision: "pending" as const,
        decided_by: null,
      })),
    );
    return { ok: true };
  }
  inst.status = "approved";
  return { ok: true };
}

/** applyBondReleaseDecision — only an approved instance releases the bond. */
export function applyRelease(world: ReleaseWorld): "pending" | "released" | "rejected" | "none" {
  const inst = world.instance;
  if (!inst) return "none";
  if (inst.status === "pending") return "pending";
  if (inst.status === "rejected") return "rejected";
  world.instrument.status = "released";
  world.audits.push({ action: "bond.released", instrument_id: world.instrument.id });
  return "released";
}
