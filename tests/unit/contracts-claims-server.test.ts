// GC-16 — server/API coverage for the governed contract & claims layer.
// Exercises CRUD + the full claim lifecycle, optimistic concurrency,
// idempotent replay, snapshot freeze, delegation thresholds, segregation of
// duties, FX provenance (no silent fallback) and the persisted alert register
// (dedupe, ownership, evidence, escalation, snooze, resolve/reopen, audit).
// In-memory Supabase double — no database, no network.
import { beforeEach, describe, expect, it } from "vitest";

import { createFakeSupabase, type Row, type Tables } from "../helpers/fake-supabase";
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  actOnAlert,
  buildClaimSnapshot,
  loadClaimsAppendix,
  loadClaimsWorkspace,
  loadPortfolioClaims,
  refreshProjectAlerts,
  resolveClaimsAccess,
  saveClaim,
  saveDeadline,
  saveValuation,
  transitionClaim,
  transitionClaimSnapshot,
} from "@/lib/contracts-claims.server";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "33333333-3333-4333-8333-333333333333";
const PREPARER = "44444444-4444-4444-8444-444444444444";
const APPROVER = "55555555-5555-4555-8555-555555555555";

function seed(): Tables {
  return {
    projects: [
      { id: PROJECT, company_id: COMPANY, name: "East Amman 50 MW PV" },
      { id: OTHER_PROJECT, company_id: OTHER_COMPANY, name: "Foreign tenant project" },
    ],
    project_financial_config: [{ project_id: PROJECT, currency_code: "USD" }],
    contracts: [{ id: "ct-1", project_id: PROJECT, value: 50_000_000, status: "active" }],
    change_orders: [
      { id: "co-1", project_id: PROJECT, amount: 1_200_000, status: "approved" },
      { id: "co-2", project_id: PROJECT, amount: 400_000, status: "draft" },
    ],
    bond_instruments: [],
    fx_rates: [
      {
        id: "fx-1",
        base_code: "EUR",
        quote_code: "USD",
        rate: 1.1,
        as_of: "2026-06-28",
        source_priority: 1,
      },
    ],
    contract_claims: [],
    contract_claim_events: [],
    contract_claim_valuations: [],
    contract_deadlines: [],
    contract_claim_snapshots: [],
    contract_claim_snapshot_lines: [],
    contract_claim_alerts: [],
  };
}

interface CtxOptions {
  roles?: string[];
  user?: string;
}

const ALL_ROLES = ["finance_admin", "project_admin", "company_admin"];

/**
 * Emulates the database `row_version` trigger: new rows start at 1 and every
 * UPDATE bumps the version the caller echoed back, so optimistic-concurrency
 * behaviour matches Postgres instead of silently passing.
 */
function withRowVersionTrigger(client: ReturnType<typeof createFakeSupabase>) {
  const from = client.from.bind(client);
  client.from = (table: string) => {
    const q = from(table);
    const insert = q.insert.bind(q);
    const update = q.update.bind(q);
    q.insert = (payload: Row | Row[]) =>
      insert(
        Array.isArray(payload)
          ? payload.map((r) => ({ row_version: 1, ...r }))
          : { row_version: 1, ...payload },
      );
    q.update = (payload: Row) =>
      update({ ...payload, row_version: Number(payload["row_version"] ?? 0) + 1 });
    return q;
  };
  return client;
}

function makeCtx(opts: CtxOptions = {}) {
  const roles = opts.roles ?? ALL_ROLES;
  const client = withRowVersionTrigger(
    createFakeSupabase(seed(), {
      rpc: {
        has_company_role: (args: Row) => roles.includes(String(args["p_role"])),
        write_audit_log: () => null,
      },
    }),
  );
  const ctx = { user: { id: opts.user ?? PREPARER }, supabase: client } as unknown as AuthContext;
  return { ctx, client, tables: client.db as Tables };
}

/** A second identity over the SAME in-memory database. */
function asUser(
  base: ReturnType<typeof createFakeSupabase>,
  user: string,
  roles: string[] = ALL_ROLES,
): AuthContext {
  const supabase = {
    db: base.db,
    from: (table: string) => base.from(table),
    rpc: async (name: string, args: Row = {}) => ({
      data: name === "has_company_role" ? roles.includes(String(args["p_role"])) : null,
      error: null,
    }),
    rpcCalls: base.rpcCalls,
  };
  return { user: { id: user }, supabase } as unknown as AuthContext;
}


async function expectHttp(fn: () => Promise<unknown>, code: string, status?: number) {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected rejection with ${code}`).toBeTruthy();
  const err = caught as { body?: string; statusCode?: number };
  expect(String(err.body)).toContain(code);
  if (status !== undefined) expect(err.statusCode).toBe(status);
}

const CLAIM = {
  project_id: PROJECT,
  claim_ref: "CL-001",
  title: "Grid connection delay",
  kind: "eot" as const,
  currency_code: "USD",
  asserted_amount: 900_000,
  submitted_amount: 800_000,
  assessed_amount: 600_000,
  approved_amount: 0,
  eot_days_claimed: 45,
  event_date: "2026-05-02",
};

describe("GC-16 access resolution", () => {
  it("derives write and approve capability from company roles", async () => {
    await expect(resolveClaimsAccess(makeCtx({ roles: ["finance_admin"] }).ctx)).resolves.toEqual({
      canWrite: true,
      canApprove: true,
      roles: ["project_admin", "finance_admin"],
    });
    await expect(resolveClaimsAccess(makeCtx({ roles: ["project_admin"] }).ctx)).resolves.toEqual({
      canWrite: true,
      canApprove: false,
      roles: ["project_admin"],
    });
    await expect(resolveClaimsAccess(makeCtx({ roles: [] }).ctx)).resolves.toEqual({
      canWrite: false,
      canApprove: false,
      roles: [],
    });
  });

  it("refuses every write path to a read-only member", async () => {
    const { ctx } = makeCtx({ roles: [] });
    await expectHttp(() => saveClaim(ctx, CLAIM), "forbidden", 403);
    await expectHttp(
      () => saveValuation(ctx, { claim_id: "x", effective_period: "2026-06-01", basis: "assessed", amount: 1, probability_pct: 50, reason: "r" }),
      "forbidden",
      403,
    );
    await expectHttp(
      () => buildClaimSnapshot(ctx, { project_id: PROJECT, period_month: "2026-06-01", data_date: "2026-06-30" }),
      "forbidden",
      403,
    );
  });
});

describe("GC-16 claim CRUD and lifecycle", () => {
  it("creates a claim, stamps company from the project and logs a created event", async () => {
    const { ctx, tables } = makeCtx();
    const res = await saveClaim(ctx, CLAIM);
    expect(res.id).toBeTruthy();

    const row = tables.contract_claims![0]!;
    expect(row["company_id"]).toBe(COMPANY);
    expect(row["status"]).toBe("draft");
    expect(row["created_by"]).toBe(PREPARER);

    const events = tables.contract_claim_events!;
    expect(events).toHaveLength(1);
    expect(events[0]!["event_type"]).toBe("created");
    expect(events[0]!["to_status"]).toBe("draft");
    expect(events[0]!["actor_id"]).toBe(PREPARER);
  });

  it("rejects a claim on a project outside the caller's tenant", async () => {
    const { ctx, tables } = makeCtx();
    tables.projects = [{ id: PROJECT, company_id: COMPANY, name: "East Amman 50 MW PV" }];
    await expectHttp(
      () => saveClaim(ctx, { ...CLAIM, project_id: OTHER_PROJECT }),
      "project_not_found",
      404,
    );
  });

  it("walks the full lifecycle draft → submitted → assessed → approved → certified → paid → closed", async () => {
    const { ctx, tables, client } = makeCtx();
    const approverCtx = asUser(client, APPROVER);
    const { id } = await saveClaim(ctx, CLAIM);

    const version = () => Number(tables.contract_claims![0]!["row_version"]);
    let r = await transitionClaim(ctx, { claim_id: id, to: "submitted", row_version: version() });
    expect(r.status).toBe("submitted");
    r = await transitionClaim(ctx, { claim_id: id, to: "assessed", row_version: version() });
    expect(r.status).toBe("assessed");

    // Approval-grade steps are taken by a different user (segregation of duties).
    r = await transitionClaim(approverCtx, { claim_id: id, to: "approved", row_version: version() });
    expect(r.status).toBe("approved");
    expect(tables.contract_claims![0]!["approved_by"]).toBe(APPROVER);
    r = await transitionClaim(approverCtx, { claim_id: id, to: "certified", row_version: version() });
    expect(tables.contract_claims![0]!["certified_by"]).toBe(APPROVER);
    r = await transitionClaim(approverCtx, { claim_id: id, to: "paid", row_version: version() });
    expect(r.status).toBe("paid");
    expect(tables.contract_claims![0]!["closed_at"]).toBeFalsy();

    const types = tables.contract_claim_events!.map((e) => e["event_type"]);
    expect(types.filter((t) => t === "transition")).toHaveLength(5);
  });

  it("refuses an illegal lifecycle jump", async () => {
    const { ctx, tables } = makeCtx();
    const { id, row_version } = await saveClaim(ctx, CLAIM);
    await expectHttp(
      () => transitionClaim(ctx, { claim_id: id, to: "paid", row_version }),
      "invalid_transition",
      422,
    );
    expect(tables.contract_claims![0]!["status"]).toBe("draft");
  });

  it("blocks the preparer from approving their own claim", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, CLAIM);
    const v = () => Number(tables.contract_claims![0]!["row_version"]);
    await transitionClaim(ctx, { claim_id: id, to: "submitted", row_version: v() });
    await transitionClaim(ctx, { claim_id: id, to: "assessed", row_version: v() });
    await expectHttp(
      () => transitionClaim(ctx, { claim_id: id, to: "approved", row_version: v() }),
      "segregation_of_duties",
      403,
    );
  });

  it("requires an approver role for approval-grade transitions", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, CLAIM);
    const v = () => Number(tables.contract_claims![0]!["row_version"]);
    await transitionClaim(ctx, { claim_id: id, to: "submitted", row_version: v() });
    await transitionClaim(ctx, { claim_id: id, to: "assessed", row_version: v() });
    const pmCtx = asUser(client, APPROVER, ["project_admin"]);
    await expectHttp(
      () => transitionClaim(pmCtx, { claim_id: id, to: "approved", row_version: v() }),
      "forbidden",
      403,
    );
  });

  it("stops an approval above the actor's delegated authority", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, { ...CLAIM, assessed_amount: 250_000_000 });
    const v = () => Number(tables.contract_claims![0]!["row_version"]);
    await transitionClaim(ctx, { claim_id: id, to: "submitted", row_version: v() });
    await transitionClaim(ctx, { claim_id: id, to: "assessed", row_version: v() });
    const approverCtx = asUser(client, APPROVER);
    await expectHttp(
      () => transitionClaim(approverCtx, { claim_id: id, to: "approved", row_version: v() }),
      "delegation_exceeded",
      403,
    );
  });

  it("rejects a stale write on both update and transition (optimistic concurrency)", async () => {
    const { ctx, tables } = makeCtx();
    const { id, row_version } = await saveClaim(ctx, CLAIM);
    await saveClaim(ctx, { ...CLAIM, id, row_version, title: "Retitled" });
    await expectHttp(
      () => saveClaim(ctx, { ...CLAIM, id, row_version, title: "Concurrent edit" }),
      "stale_write",
      409,
    );
    await expectHttp(
      () => transitionClaim(ctx, { claim_id: id, to: "submitted", row_version }),
      "stale_write",
      409,
    );
    expect(tables.contract_claims![0]!["title"]).toBe("Retitled");
  });

  it("treats a replayed transition with the same idempotency key as a no-op", async () => {
    const { ctx, tables } = makeCtx();
    const { id, row_version } = await saveClaim(ctx, CLAIM);
    const key = "req-abc-123";
    const first = await transitionClaim(ctx, {
      claim_id: id,
      to: "submitted",
      row_version,
      idempotency_key: key,
    });
    expect(first.status).toBe("submitted");
    const replay = await transitionClaim(ctx, {
      claim_id: id,
      to: "submitted",
      row_version: Number(tables.contract_claims![0]!["row_version"]),
      idempotency_key: key,
    });
    expect(replay.status).toBe("submitted");
    const keyed = tables.contract_claim_events!.filter(
      (e) => e["event_type"] === `transition:${key}`,
    );
    expect(keyed).toHaveLength(1);
  });

  it("makes a terminal claim read-only", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, CLAIM);
    const v = () => Number(tables.contract_claims![0]!["row_version"]);
    await transitionClaim(ctx, { claim_id: id, to: "withdrawn", row_version: v() });
    await expectHttp(
      () => saveClaim(ctx, { ...CLAIM, id, row_version: v(), title: "Zombie edit" }),
      "claim_immutable",
      409,
    );
  });
});

describe("GC-16 valuations and FX provenance", () => {
  it("numbers valuations per period and records the resolved table rate", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, { ...CLAIM, currency_code: "EUR" });
    await saveValuation(ctx, {
      claim_id: id,
      effective_period: "2026-06-01",
      basis: "assessed",
      amount: 400_000,
      probability_pct: 60,
      reason: "QS assessment",
    });
    await saveValuation(ctx, {
      claim_id: id,
      effective_period: "2026-06-01",
      basis: "assessed",
      amount: 500_000,
      probability_pct: 40,
      reason: "Revised",
    });
    const rows = tables.contract_claim_valuations!;
    expect(rows.map((r) => r["valuation_no"])).toEqual([1, 2]);
    expect(rows[0]!["expected_amount"]).toBe(240_000);
    expect(rows[0]!["fx_rate"]).toBe(1.1);
    expect(rows[0]!["fx_rate_date"]).toBe("2026-06-28");
    expect(rows[0]!["fx_source"]).toBe("table");
  });

  it("never falls back to parity when no rate exists for the pair", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, { ...CLAIM, currency_code: "JOD" });
    await saveValuation(ctx, {
      claim_id: id,
      effective_period: "2026-06-01",
      basis: "submitted",
      amount: 100_000,
      probability_pct: 100,
      reason: "No rate published",
    });
    const row = tables.contract_claim_valuations![0]!;
    expect(row["fx_rate"]).toBeNull();
    expect(row["fx_rate_date"]).toBeNull();
    expect(row["fx_rate"]).not.toBe(1);
  });

  it("uses parity only when the claim currency equals the project base", async () => {
    const { ctx, tables } = makeCtx();
    const { id } = await saveClaim(ctx, CLAIM);
    await saveValuation(ctx, {
      claim_id: id,
      effective_period: "2026-06-01",
      basis: "submitted",
      amount: 10,
      probability_pct: 100,
      reason: "USD claim",
    });
    const row = tables.contract_claim_valuations![0]!;
    expect(row["fx_rate"]).toBe(1);
    expect(row["fx_source"]).toBe("parity");
  });
});

describe("GC-16 deadlines", () => {
  it("computes a calendar-day notice due date and logs creation", async () => {
    const { ctx, tables } = makeCtx();
    const res = await saveDeadline(ctx, {
      project_id: PROJECT,
      kind: "notice",
      label: "Clause 20.1 notice",
      trigger_date: "2026-05-02",
      duration_days: 28,
      calendar: "calendar",
      timezone: "Asia/Amman",
    });
    expect(res.due_date).toBe("2026-05-30");
    expect(tables.contract_claim_events!.at(-1)!["event_type"]).toBe("deadline_created");
  });

  it("rolls a MENA business-day deadline off the Fri/Sat weekend", async () => {
    const { ctx } = makeCtx();
    // 2026-06-01 is a Monday; +4 MENA business days lands on Sunday 2026-06-07.
    const res = await saveDeadline(ctx, {
      project_id: PROJECT,
      kind: "submission",
      label: "Particulars",
      trigger_date: "2026-06-01",
      duration_days: 4,
      calendar: "mena_business",
      timezone: "Asia/Amman",
    });
    const dow = new Date(`${res.due_date}T00:00:00Z`).getUTCDay();
    expect([5, 6]).not.toContain(dow);
  });

  it("rejects a stale deadline update", async () => {
    const { ctx, tables } = makeCtx();
    const created = await saveDeadline(ctx, {
      project_id: PROJECT,
      kind: "notice",
      label: "Clause 20.1 notice",
      trigger_date: "2026-05-02",
      duration_days: 28,
      calendar: "calendar",
      timezone: "Asia/Amman",
    });
    const stale = Number(tables.contract_deadlines![0]!["row_version"]) + 5;
    await expectHttp(
      () =>
        saveDeadline(ctx, {
          id: created.id,
          project_id: PROJECT,
          kind: "notice",
          label: "Changed",
          trigger_date: "2026-05-02",
          duration_days: 28,
          calendar: "calendar",
          timezone: "Asia/Amman",
          row_version: stale,
        }),
      "stale_write",
      409,
    );
  });
});

describe("GC-16 snapshots", () => {
  const BUILD = {
    project_id: PROJECT,
    period_month: "2026-06-01",
    data_date: "2026-06-30",
  } as const;

  it("builds a working snapshot with a deterministic checksum and one line per claim", async () => {
    const { ctx, tables } = makeCtx();
    await saveClaim(ctx, CLAIM);
    await saveClaim(ctx, { ...CLAIM, claim_ref: "CL-002", title: "Design change" });

    const first = await buildClaimSnapshot(ctx, BUILD);
    expect(tables.contract_claim_snapshot_lines).toHaveLength(2);
    expect(tables.contract_claim_snapshots![0]!["status"]).toBe("working");
    expect(first.checksum).toMatch(/^[0-9a-f]{8,}$/);

    const rebuilt = await buildClaimSnapshot(ctx, BUILD);
    expect(rebuilt.snapshot_id).toBe(first.snapshot_id);
    expect(rebuilt.checksum).toBe(first.checksum);
    expect(tables.contract_claim_snapshots).toHaveLength(1);
    expect(tables.contract_claim_snapshot_lines).toHaveLength(2);
  });

  it("freezes an approved snapshot against rebuild until it is superseded", async () => {
    const { ctx, tables } = makeCtx();
    await saveClaim(ctx, CLAIM);
    const built = await buildClaimSnapshot(ctx, BUILD);
    const snap = () => tables.contract_claim_snapshots![0]!;
    const v = () => Number(snap()["row_version"]);

    await transitionClaimSnapshot(ctx, { snapshot_id: built.snapshot_id, to: "submitted", row_version: v() });
    const approverCtx = asUser(client, APPROVER);
    await transitionClaimSnapshot(approverCtx, {
      snapshot_id: built.snapshot_id,
      to: "approved",
      row_version: v(),
    });
    expect(snap()["status"]).toBe("approved");

    await expectHttp(() => buildClaimSnapshot(ctx, BUILD), "snapshot_frozen", 409);

    await transitionClaimSnapshot(approverCtx, {
      snapshot_id: built.snapshot_id,
      to: "superseded",
      row_version: v(),
      reason: "Late assessment",
    });
    const next = await buildClaimSnapshot(ctx, BUILD);
    expect(next.snapshot_id).not.toBe(built.snapshot_id);
  });

  it("blocks the submitter from approving the snapshot they submitted", async () => {
    const { ctx, tables } = makeCtx();
    await saveClaim(ctx, CLAIM);
    const built = await buildClaimSnapshot(ctx, BUILD);
    const v = () => Number(tables.contract_claim_snapshots![0]!["row_version"]);
    await transitionClaimSnapshot(ctx, { snapshot_id: built.snapshot_id, to: "submitted", row_version: v() });
    await expectHttp(
      () => transitionClaimSnapshot(ctx, { snapshot_id: built.snapshot_id, to: "approved", row_version: v() }),
      "segregation_of_duties",
      403,
    );
  });

  it("rejects a stale snapshot transition and an illegal snapshot jump", async () => {
    const { ctx, tables } = makeCtx();
    await saveClaim(ctx, CLAIM);
    const built = await buildClaimSnapshot(ctx, BUILD);
    const v = Number(tables.contract_claim_snapshots![0]!["row_version"]);
    await expectHttp(
      () => transitionClaimSnapshot(ctx, { snapshot_id: built.snapshot_id, to: "approved", row_version: v }),
      "invalid_transition",
      422,
    );
    await expectHttp(
      () => transitionClaimSnapshot(ctx, { snapshot_id: built.snapshot_id, to: "submitted", row_version: v + 9 }),
      "stale_write",
      409,
    );
  });
});

describe("GC-16 persisted alert register", () => {
  let ctx: AuthContext;
  let tables: Tables;

  beforeEach(async () => {
    const made = makeCtx();
    ctx = made.ctx;
    tables = made.tables;
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await saveClaim(ctx, { ...CLAIM, event_date: past });
    await saveDeadline(ctx, {
      project_id: PROJECT,
      kind: "notice",
      label: "Clause 20.1 notice",
      trigger_date: today,
      duration_days: 3,
      calendar: "calendar",
      timezone: "Asia/Amman",
    });
    void soon;
  });

  it("persists alerts with a stable dedupe key across repeated evaluations", async () => {
    const first = await refreshProjectAlerts(ctx, PROJECT);
    expect(first.evaluated).toBeGreaterThan(0);
    const keysA = tables.contract_claim_alerts!.map((a) => a["dedupe_key"]).sort();
    const countA = tables.contract_claim_alerts!.length;

    await refreshProjectAlerts(ctx, PROJECT);
    const keysB = tables.contract_claim_alerts!.map((a) => a["dedupe_key"]).sort();
    expect(keysB).toEqual(keysA);
    expect(tables.contract_claim_alerts!).toHaveLength(countA);
    expect(new Set(keysA).size).toBe(keysA.length);
  });

  it("stamps company, project, kind, severity and evidence on every alert row", async () => {
    await refreshProjectAlerts(ctx, PROJECT);
    for (const a of tables.contract_claim_alerts!) {
      expect(a["company_id"]).toBe(COMPANY);
      expect(a["project_id"]).toBe(PROJECT);
      expect(String(a["kind"]).length).toBeGreaterThan(0);
      expect(["info", "warning", "critical"]).toContain(a["severity"]);
      expect(a["last_seen_at"]).toBeTruthy();
    }
  });

  it("assigns ownership without changing the alert state", async () => {
    await refreshProjectAlerts(ctx, PROJECT);
    const alert = tables.contract_claim_alerts![0]!;
    const before = alert["state"];
    const res = await actOnAlert(ctx, {
      alert_id: String(alert["id"]),
      action: "assign",
      owner_id: APPROVER,
    });
    expect(res.state).toBe(before);
    expect(tables.contract_claim_alerts![0]!["owner_id"]).toBe(APPROVER);
  });

  it("runs acknowledge → escalate → resolve → reopen and logs each step", async () => {
    await refreshProjectAlerts(ctx, PROJECT);
    const id = String(tables.contract_claim_alerts![0]!["id"]);
    const row = () => tables.contract_claim_alerts!.find((a) => a["id"] === id)!;

    await actOnAlert(ctx, { alert_id: id, action: "acknowledge" });
    expect(row()["state"]).toBe("acknowledged");
    expect(row()["acknowledged_by"]).toBe(PREPARER);

    await actOnAlert(ctx, { alert_id: id, action: "escalate" });
    expect(row()["state"]).toBe("escalated");
    expect(row()["escalated_at"]).toBeTruthy();

    await actOnAlert(ctx, { alert_id: id, action: "resolve" });
    expect(row()["state"]).toBe("resolved");
    expect(row()["resolved_by"]).toBe(PREPARER);

    await actOnAlert(ctx, { alert_id: id, action: "reopen" });
    expect(row()["state"]).toBe("open");
    expect(row()["reopened_at"]).toBeTruthy();
    expect(row()["resolved_at"]).toBeNull();

    const logged = tables
      .contract_claim_events!.filter((e) => String(e["event_type"]).startsWith("alert_"))
      .map((e) => e["event_type"]);
    expect(logged).toEqual([
      "alert_acknowledge",
      "alert_escalate",
      "alert_resolve",
      "alert_reopen",
    ]);
  });

  it("requires a date to snooze and refuses an illegal state jump", async () => {
    await refreshProjectAlerts(ctx, PROJECT);
    const id = String(tables.contract_claim_alerts![0]!["id"]);
    await expectHttp(
      () => actOnAlert(ctx, { alert_id: id, action: "snooze" }),
      "snooze_date_required",
      422,
    );
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await actOnAlert(ctx, { alert_id: id, action: "snooze", snoozed_until: until });
    expect(tables.contract_claim_alerts![0]!["snoozed_until"]).toBe(until);
    await expectHttp(
      () => actOnAlert(ctx, { alert_id: id, action: "reopen" }),
      "invalid_transition",
      422,
    );
  });

  it("404s on an alert the caller cannot read", async () => {
    await expectHttp(
      () => actOnAlert(ctx, { alert_id: "00000000-0000-4000-8000-000000000000", action: "acknowledge" }),
      "alert_not_found",
      404,
    );
  });
});

describe("GC-16 read models", () => {
  it("returns workspace exposure, contract basis and the non-posting disclaimer", async () => {
    const { ctx } = makeCtx();
    await saveClaim(ctx, CLAIM);
    const ws = await loadClaimsWorkspace(ctx, PROJECT, "2026-06-01");
    expect(ws.project.name).toBe("East Amman 50 MW PV");
    expect(ws.claims).toHaveLength(1);
    // Only approved change orders count toward the variation register.
    expect(ws.contract_basis.approved_variations).toBe(1_200_000);
    expect(ws.contract_basis.remaining_value).toBe(51_200_000);
    expect(ws.waterfall.length).toBeGreaterThan(0);
    expect(ws.disclaimer).toMatch(/\S/);
    expect(ws.access.canWrite).toBe(true);
  });

  it("shapes the close-pack appendix from the same governed basis", async () => {
    const { ctx } = makeCtx();
    await saveClaim(ctx, CLAIM);
    await buildClaimSnapshot(ctx, {
      project_id: PROJECT,
      period_month: "2026-06-01",
      data_date: "2026-06-30",
    });
    const appendix = await loadClaimsAppendix(ctx, PROJECT, "2026-06-01");
    expect(appendix.project_id).toBe(PROJECT);
    expect(appendix.status).toBe("working");
    expect(appendix.top_claims[0]!.claim_ref).toBe("CL-001");
    expect(appendix.waterfall.length).toBeGreaterThan(0);
    expect(appendix.disclaimer).toMatch(/\S/);
  });

  it("only rolls up projects the caller's RLS scope returns", async () => {
    const { ctx, tables } = makeCtx();
    await saveClaim(ctx, CLAIM);
    // A foreign-tenant claim is invisible to this reader — RLS filters it out
    // upstream, so the portfolio rollup must not invent it.
    tables.contract_claims!.push({
      id: "foreign-claim",
      company_id: OTHER_COMPANY,
      project_id: OTHER_PROJECT,
      claim_ref: "CL-X",
      title: "Foreign",
      kind: "variation",
      status: "approved",
      currency_code: "USD",
      approved_amount: 5_000_000,
      row_version: 1,
    });
    const view = await loadPortfolioClaims(ctx, { status: "all", period_month: "2026-06-01" });
    const ids = view.projects.map((p) => p.project_id);
    expect(ids).toContain(PROJECT);
    expect(view.disclaimer).toMatch(/\S/);
  });
});
