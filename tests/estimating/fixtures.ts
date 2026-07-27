// P-214 — Typed factories + an offline Supabase context for the estimating
// suite. No network: every "server" call runs against the in-memory double
// from tests/helpers/fake-supabase.ts driven by the shipped server helpers.

import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { EstimateLineRow, EstimateRow } from "@/lib/estimating.server";
import { createFakeSupabase, type Row, type Tables } from "../helpers/fake-supabase";

export const COMPANY_A = "company-a";
export const COMPANY_B = "company-b";
export const USER_ID = "user-eng";

/* ------------------------------------------------------------- factories */

export interface RateFixture extends Row {
  id: string;
  company_id: string;
  rate_type: string;
  name: string;
  uom: string;
  unit_rate: number;
  currency_code: string;
}

export function makeRate(overrides: Partial<RateFixture> = {}): RateFixture {
  return {
    id: "rate-1",
    company_id: COMPANY_A,
    rate_type: "material",
    name: "PV module 580 Wp",
    uom: "pc",
    unit_rate: 120,
    currency_code: "USD",
    category: "modules",
    supplier: "Vendor A",
    valid_from: "2026-01-01",
    valid_to: null,
    notes: null,
    ...overrides,
  };
}

export function makeEstimate(overrides: Partial<EstimateRow> & Row = {}): EstimateRow & Row {
  return {
    id: "est-1",
    company_id: COMPANY_A,
    estimate_number: "EST-0001",
    title: "East Amman 50 MW PV",
    project_id: "proj-1",
    opportunity_id: "opp-1",
    bom_snapshot_id: null,
    revision: 1,
    status: "draft",
    currency_code: "USD",
    direct_cost: 100_000,
    escalation_pct: 2,
    contingency_pct: 5,
    overhead_pct: 8,
    profit_pct: 10,
    subtotal: 115_668,
    total_price: 127_234.8,
    priced_at: null,
    supersedes_id: null,
    approval_instance_id: null,
    submitted_at: null,
    submitted_by: null,
    approved_at: null,
    approved_by: null,
    rejection_comment: null,
    converted_proposal_id: null,
    converted_at: null,
    converted_by: null,
    created_by: USER_ID,
    updated_at: "2026-07-27T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as EstimateRow & Row;
}

export function makeLine(overrides: Partial<EstimateLineRow> & Row = {}): EstimateLineRow & Row {
  return {
    id: "line-1",
    company_id: COMPANY_A,
    estimate_id: "est-1",
    line_type: "material",
    description: "PV module 580 Wp",
    qty: 100,
    uom: "pc",
    unit_rate: 120,
    amount: 12_000,
    rate_library_id: null,
    source_bom_line_id: null,
    sort_order: 0,
    notes: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as EstimateLineRow & Row;
}

export interface BomLineFixture extends Row {
  id: string;
  snapshot_id: string;
  item: string;
  spec: string | null;
  qty_buffered: number;
  unit: string;
  unit_cost: number | null;
  category: string;
}

export function makeBomLine(overrides: Partial<BomLineFixture> = {}): BomLineFixture {
  return {
    id: "bom-1",
    snapshot_id: "snap-1",
    item: "PV module 580 Wp",
    spec: "Bifacial",
    qty_buffered: 10,
    unit: "pc",
    unit_cost: 120,
    category: "modules",
    ...overrides,
  };
}

export function makeProposal(overrides: Row = {}): Row {
  return {
    id: "prop-1",
    company_id: COMPANY_A,
    opportunity_id: "opp-1",
    project_id: "proj-1",
    title: "East Amman 50 MW PV",
    version: 1,
    status: "draft",
    currency_code: "USD",
    subtotal: 0,
    margin_pct: 0,
    contingency_pct: 0,
    total: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------- offline context */

export interface WorldOptions {
  roles?: readonly string[];
  userId?: string;
  companyId?: string | null;
  rpc?: Record<string, (args: Row) => unknown>;
  failOn?: (table: string, op: string) => string | null;
  newId?: () => string;
}

export interface World {
  ctx: AuthContext;
  db: Tables;
  rpcCalls: Array<{ name: string; args: Row }>;
  audits: () => Array<{ name: string; args: Row }>;
}

export const ENGINEERING_ROLES = ["engineering_admin"] as const;

/** Build an AuthContext backed by the in-memory Supabase double. */
export function makeWorld(seed: Tables = {}, options: WorldOptions = {}): World {
  const roles = options.roles ?? ENGINEERING_ROLES;
  const userId = options.userId ?? USER_ID;
  const companyId = options.companyId === undefined ? COMPANY_A : options.companyId;
  let n = 0;
  const supabase = createFakeSupabase(
    { profiles: [{ id: userId, company_id: companyId }], ...seed },
    {
      newId: options.newId ?? (() => `new-${++n}`),
      failOn: options.failOn,
      rpc: {
        has_company_role: (args) => roles.includes(String(args.p_role)),
        write_audit_log: () => null,
        ...options.rpc,
      },
    },
  );
  const ctx = { supabase, user: { id: userId } } as unknown as AuthContext;
  return {
    ctx,
    db: supabase.db,
    rpcCalls: supabase.rpcCalls,
    audits: () => supabase.rpcCalls.filter((c) => c.name === "write_audit_log"),
  };
}

/** Assert a thrown httpError carries the expected status + code. */
export async function expectHttpError(
  run: () => Promise<unknown>,
): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (err) {
    const e = err as { statusCode?: number; body?: string };
    const parsed = e.body ? (JSON.parse(e.body) as { error: string }) : { error: "" };
    return { status: e.statusCode ?? 0, code: parsed.error };
  }
  throw new Error("expected the call to throw an httpError");
}

/* ------------------------------------------------- approval chain harness */

export type Decision = "pending" | "approved" | "rejected";

export interface ChainApproval {
  step_order: number;
  role: string;
  decision: Decision;
  decided_by: string | null;
  comment: string | null;
}

export interface ChainInstance {
  id: string;
  status: "pending" | "approved" | "rejected";
  current_step: number;
  approvals: ChainApproval[];
}

/** Seeded estimate_approval rule: engineering_admin → finance_admin. */
export const ESTIMATE_CHAIN_STEPS = ["engineering_admin", "finance_admin"] as const;

export interface ChainWorld {
  instance: ChainInstance | null;
  holders: Record<string, string[]>;
}

export function makeChainWorld(
  holders: Record<string, string[]> = {
    engineering_admin: ["user-eng"],
    finance_admin: ["user-fin"],
  },
): ChainWorld {
  return { instance: null, holders };
}

/** Mirror of start_approval_instance for the estimate_approval rule. */
export function startChain(world: ChainWorld): ChainInstance {
  world.instance = {
    id: "appr-1",
    status: "pending",
    current_step: 1,
    approvals: world.holders[ESTIMATE_CHAIN_STEPS[0]].map(() => ({
      step_order: 1,
      role: ESTIMATE_CHAIN_STEPS[0],
      decision: "pending" as Decision,
      decided_by: null,
      comment: null,
    })),
  };
  return world.instance;
}

/** Mirror of decide_approval: only current-step role holders may decide. */
export function decideChain(
  world: ChainWorld,
  actor: string,
  decision: "approved" | "rejected",
  comment: string | null = null,
): { ok: boolean; error?: string } {
  const inst = world.instance;
  if (!inst || inst.status !== "pending") return { ok: false, error: "not_pending" };
  const role = ESTIMATE_CHAIN_STEPS[inst.current_step - 1];
  if (!world.holders[role]?.includes(actor)) return { ok: false, error: "wrong_role" };
  const row = inst.approvals.find((a) => a.step_order === inst.current_step && !a.decided_by);
  if (!row) return { ok: false, error: "no_row" };
  row.decision = decision;
  row.decided_by = actor;
  row.comment = comment;
  if (decision === "rejected") {
    inst.status = "rejected";
    return { ok: true };
  }
  if (inst.current_step >= ESTIMATE_CHAIN_STEPS.length) {
    inst.status = "approved";
    return { ok: true };
  }
  inst.current_step += 1;
  const next = ESTIMATE_CHAIN_STEPS[inst.current_step - 1];
  for (const holder of world.holders[next] ?? []) {
    void holder;
    inst.approvals.push({
      step_order: inst.current_step,
      role: next,
      decision: "pending",
      decided_by: null,
      comment: null,
    });
  }
  return { ok: true };
}
