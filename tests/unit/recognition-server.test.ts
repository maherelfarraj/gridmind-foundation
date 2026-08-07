// GC-15 verification — dedicated server/API coverage for the recognition I/O
// layer: workspace, basis gathering, snapshot build/save/lifecycle/correct/
// supersede, settings, obligation versioning, adjustment prepare/authorise/
// void, alert rows and appendix loaders. Uses the in-memory Supabase double,
// so it never touches the network and stays deterministic.
import { beforeEach, describe, expect, it } from "vitest";

import { createFakeSupabase, type Tables } from "../helpers/fake-supabase";

import {
  buildSnapshot,
  correctSnapshot,
  decideAdjustment,
  loadRecognitionAlertRows,
  loadRecognitionAppendix,
  loadRecognitionWorkspace,
  loadSettings,
  listObligations,
  policyFrom,
  resolveRecognitionAccess,
  saveAdjustment,
  saveObligation,
  saveSettings,
  transitionSnapshot,
} from "@/lib/recognition.server";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const PREPARER = "44444444-4444-4444-8444-444444444444";
const APPROVER = "55555555-5555-4555-8555-555555555555";

type Ctx = Parameters<typeof loadSettings>[0];

function seed(): Tables {
  return {
    projects: [{ id: PROJECT, company_id: COMPANY, name: "East Amman", client_name: "NEPCO" }],
    project_financial_config: [{ project_id: PROJECT, currency_code: "USD" }],
    contracts: [
      {
        id: CONTRACT,
        project_id: PROJECT,
        company_id: COMPANY,
        contract_number: "C-001",
        counterparty: "NEPCO",
        status: "active",
        value: 1_000_000,
        currency_code: "USD",
      },
    ],
    change_orders: [
      {
        id: "co-1",
        project_id: PROJECT,
        contract_id: CONTRACT,
        status: "approved",
        amount: 100_000,
      },
      {
        id: "co-2",
        project_id: PROJECT,
        contract_id: CONTRACT,
        status: "submitted",
        amount: 50_000,
      },
    ],
    invoices: [
      {
        id: "inv-1",
        project_id: PROJECT,
        company_id: COMPANY,
        contract_id: CONTRACT,
        direction: "receivable",
        status: "approved",
        amount: 400_000,
        issue_date: "2026-06-20",
      },
      {
        id: "inv-late",
        project_id: PROJECT,
        company_id: COMPANY,
        contract_id: CONTRACT,
        direction: "receivable",
        status: "approved",
        amount: 999_999,
        issue_date: "2026-08-01",
      },
    ],
    payments: [
      {
        id: "pay-1",
        project_id: PROJECT,
        invoice_id: "inv-1",
        record_status: "posted",
        amount: 250_000,
        payment_date: "2026-06-25",
      },
    ],
    fx_rates: [],
    recognition_settings: [],
    recognition_obligations: [],
    recognition_snapshots: [],
    recognition_snapshot_lines: [],
    recognition_exceptions: [],
    recognition_adjustments: [],
    recognition_events: [],
  };
}

interface CtxOptions {
  roles?: string[];
  user?: string;
  tables?: Tables;
}

function makeCtx(opts: CtxOptions = {}) {
  const roles = opts.roles ?? ["finance_admin"];
  const client = createFakeSupabase(opts.tables ?? seed(), {
    rpc: {
      has_company_role: (args) => roles.includes(String(args["p_role"])),
      write_audit_log: () => null,
    },
  });
  const ctx = {
    user: { id: opts.user ?? PREPARER },
    supabase: client,
  } as unknown as Ctx;
  return { ctx, client };
}

async function expectHttp(fn: () => Promise<unknown>, code: string, status?: number) {
  await expect(fn()).rejects.toThrow();
  try {
    await fn();
    throw new Error("expected rejection");
  } catch (e) {
    const err = e as { body?: string; statusCode?: number };
    expect(String(err.body)).toContain(code);
    if (status) expect(err.statusCode).toBe(status);
  }
}

const BUILD = {
  project_id: PROJECT,
  period_month: "2026-06-01",
  data_date: "2026-06-30",
  billing_cutoff: "2026-06-30",
} as const;

describe("recognition access + settings", () => {
  it("resolves write and approve capability from company roles", async () => {
    const admin = makeCtx({ roles: ["finance_admin"] });
    await expect(resolveRecognitionAccess(admin.ctx)).resolves.toEqual({
      canWrite: true,
      canApprove: true,
    });

    const pm = makeCtx({ roles: ["project_admin"] });
    await expect(resolveRecognitionAccess(pm.ctx)).resolves.toEqual({
      canWrite: true,
      canApprove: false,
    });

    const viewer = makeCtx({ roles: [] });
    await expect(resolveRecognitionAccess(viewer.ctx)).resolves.toEqual({
      canWrite: false,
      canApprove: false,
    });
  });

  it("saves settings idempotently per project and logs an append-only event", async () => {
    const { ctx, client } = makeCtx();
    const first = await saveSettings(ctx, {
      project_id: PROJECT,
      default_method: "cost_to_cost",
      policy_version: "v1",
      constraint_pct: 5,
      include_unapproved_variations: false,
      include_unapproved_claims: false,
      loss_provision_enabled: true,
      cap_progress_at_100: true,
      allow_revenue_reversal: false,
      retention_pct: 10,
      advance_recovery_pct: 0,
      reporting_currency: "USD",
    });
    const second = await saveSettings(ctx, {
      project_id: PROJECT,
      default_method: "milestone",
      policy_version: "v2",
      constraint_pct: 0,
      include_unapproved_variations: true,
      include_unapproved_claims: false,
      loss_provision_enabled: true,
      cap_progress_at_100: true,
      allow_revenue_reversal: false,
      retention_pct: 10,
      advance_recovery_pct: 0,
      reporting_currency: "USD",
    });

    expect(second.id).toBe(first.id);
    expect(client.db["recognition_settings"]).toHaveLength(1);
    const settings = await loadSettings(ctx, PROJECT);
    expect(settings?.default_method).toBe("milestone");
    expect(policyFrom(settings).policy_version).toBe("v2");
    expect(policyFrom(null).default_method).toBe("cost_to_cost");
    expect(client.db["recognition_events"]).toHaveLength(2);
    expect(client.db["recognition_events"]?.[0]?.["event_type"]).toBe("settings_saved");
  });

  it("refuses settings writes without a controls role", async () => {
    const { ctx } = makeCtx({ roles: [] });
    await expectHttp(
      () =>
        saveSettings(ctx, {
          project_id: PROJECT,
          default_method: "cost_to_cost",
          policy_version: "v1",
          constraint_pct: 0,
          include_unapproved_variations: false,
          include_unapproved_claims: false,
          loss_provision_enabled: true,
          cap_progress_at_100: true,
          allow_revenue_reversal: false,
          retention_pct: 0,
          advance_recovery_pct: 0,
          reporting_currency: "USD",
        }),
      "forbidden",
      403,
    );
  });
});

const OBLIGATION = {
  project_id: PROJECT,
  contract_id: CONTRACT,
  code: "POB-1",
  name: "EPC scope",
  method: "cost_to_cost",
  progress_basis: "cost",
  allocation_amount: 1_000_000,
  standalone_value: 1_000_000,
  currency_code: "USD",
  milestones: [],
  constraint_pct: 0,
  is_loss_making: false,
  retention_pct: 10,
  advance_amount: 0,
  advance_recovery_pct: 0,
  tax_treatment: "exclusive",
  status: "active",
} as const;

describe("recognition obligations", () => {
  it("creates, versions and rejects stale-version updates", async () => {
    const { ctx, client } = makeCtx();
    const created = await saveObligation(ctx, { ...OBLIGATION });
    const row = client.db["recognition_obligations"]?.[0] as Record<string, unknown>;
    row["row_version"] = 1;

    await saveObligation(ctx, {
      ...OBLIGATION,
      id: created.id,
      name: "EPC scope v2",
      row_version: 1,
    });
    expect(row["name"]).toBe("EPC scope v2");
    expect(row["row_version"]).toBe(2);

    await expectHttp(
      () => saveObligation(ctx, { ...OBLIGATION, id: created.id, row_version: 1 }),
      "version_conflict",
      409,
    );
    await expectHttp(
      () => saveObligation(ctx, { ...OBLIGATION, id: created.id }),
      "row_version_required",
      400,
    );

    const list = await listObligations(ctx, PROJECT);
    expect(list).toHaveLength(1);
    const events = (client.db["recognition_events"] ?? []).map((e) => e["event_type"]);
    expect(events).toContain("obligation_created");
    expect(events).toContain("obligation_updated");
  });

  it("blocks obligation writes for read-only members", async () => {
    const { ctx } = makeCtx({ roles: [] });
    await expectHttp(() => saveObligation(ctx, { ...OBLIGATION }), "forbidden", 403);
  });
});

describe("recognition snapshot build and lifecycle", () => {
  let ctx: Ctx;
  let client: ReturnType<typeof createFakeSupabase>;

  beforeEach(async () => {
    const made = makeCtx();
    ctx = made.ctx;
    client = made.client;
    await saveObligation(ctx, { ...OBLIGATION });
  });

  it("builds a working snapshot from authoritative sources without mutating them", async () => {
    const before = JSON.stringify({
      contracts: client.db["contracts"],
      change_orders: client.db["change_orders"],
      invoices: client.db["invoices"],
      payments: client.db["payments"],
      fx_rates: client.db["fx_rates"],
    });

    const { id } = await buildSnapshot(ctx, { ...BUILD });
    const snap = (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === id)!;

    expect(snap["status"]).toBe("working");
    expect(snap["version_no"]).toBe(1);
    expect(snap["prepared_by"]).toBe(PREPARER);
    expect(snap["project_currency"]).toBe("USD");
    // Billing beyond the cutoff is excluded from the frozen basis.
    const lines = client.db["recognition_snapshot_lines"] ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(Number(lines[0]?.["billed_to_date"])).toBe(400_000);
    expect(Number(lines[0]?.["cash_received"])).toBe(250_000);

    expect(
      JSON.stringify({
        contracts: client.db["contracts"],
        change_orders: client.db["change_orders"],
        invoices: client.db["invoices"],
        payments: client.db["payments"],
        fx_rates: client.db["fx_rates"],
      }),
    ).toBe(before);
  });

  it("is deterministic: a rebuild replaces the working snapshot with identical totals", async () => {
    const first = await buildSnapshot(ctx, { ...BUILD });
    const totalsA = JSON.stringify(
      (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === first.id)?.["totals"],
    );

    const second = await buildSnapshot(ctx, { ...BUILD });
    const snaps = client.db["recognition_snapshots"] ?? [];
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.["id"]).toBe(second.id);
    expect(snaps[0]?.["version_no"]).toBe(2);
    expect(JSON.stringify(snaps[0]?.["totals"])).toBe(totalsA);
  });

  it("enforces the lifecycle: valid transitions, concurrency and segregation of duties", async () => {
    const { id } = await buildSnapshot(ctx, { ...BUILD });
    const snap = (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === id)!;
    snap["row_version"] = 1;

    // working -> approved is not a valid jump.
    await expectHttp(
      () => transitionSnapshot(ctx, { snapshot_id: id, to_status: "approved", row_version: 1 }),
      "invalid_transition",
      409,
    );

    await transitionSnapshot(ctx, { snapshot_id: id, to_status: "submitted", row_version: 1 });
    expect(snap["status"]).toBe("submitted");
    expect(snap["submitted_by"]).toBe(PREPARER);
    expect(snap["row_version"]).toBe(2);

    // Stale token loses (checked with a preparer-legal transition).
    await expectHttp(
      () => transitionSnapshot(ctx, { snapshot_id: id, to_status: "working", row_version: 1 }),
      "version_conflict",
      409,
    );

    // The preparer/submitter may not approve their own snapshot.
    await expectHttp(
      () => transitionSnapshot(ctx, { snapshot_id: id, to_status: "approved", row_version: 2 }),
      "segregation_of_duties",
      403,
    );

    const approverCtx = makeCtxSharing(client, APPROVER, ["finance_admin"]);
    await transitionSnapshot(approverCtx, {
      snapshot_id: id,
      to_status: "approved",
      row_version: 2,
    });
    expect(snap["status"]).toBe("approved");
    expect(snap["approved_by"]).toBe(APPROVER);

    const eventTypes = (client.db["recognition_events"] ?? []).map((e) => e["event_type"]);
    expect(eventTypes).toContain("snapshot_submitted");
    expect(eventTypes).toContain("snapshot_approved");
  });

  it("blocks approval while a critical exception is open", async () => {
    const { id } = await buildSnapshot(ctx, { ...BUILD });
    const snap = (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === id)!;
    snap["row_version"] = 1;
    (client.db["recognition_exceptions"] ??= []).push({
      id: "ex-critical",
      snapshot_id: id,
      code: "reconciliation_failed",
      severity: "critical",
      message: "Movement does not tie",
      context: {},
    });
    await transitionSnapshot(ctx, { snapshot_id: id, to_status: "submitted", row_version: 1 });
    const approverCtx = makeCtxSharing(client, APPROVER, ["finance_admin"]);
    await expectHttp(
      () =>
        transitionSnapshot(approverCtx, { snapshot_id: id, to_status: "approved", row_version: 2 }),
      "approval_blocked",
      409,
    );
  });

  it("corrects an approved snapshot by superseding it and linking the replacement", async () => {
    const { id } = await buildSnapshot(ctx, { ...BUILD });
    const snap = (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === id)!;
    snap["row_version"] = 1;
    await transitionSnapshot(ctx, { snapshot_id: id, to_status: "submitted", row_version: 1 });
    const approverCtx = makeCtxSharing(client, APPROVER, ["finance_admin"]);
    await transitionSnapshot(approverCtx, {
      snapshot_id: id,
      to_status: "approved",
      row_version: 2,
    });

    // A working snapshot cannot be corrected — only an approved one.
    await expectHttp(
      () => correctSnapshot(approverCtx, { snapshot_id: "missing-id", reason: "wrong basis" }),
      "snapshot_not_found",
      404,
    );

    const replacement = await correctSnapshot(approverCtx, {
      snapshot_id: id,
      reason: "Restated after contract variation approval",
    });
    const rebuilt = (client.db["recognition_snapshots"] ?? []).find(
      (s) => s["id"] === replacement.id,
    )!;

    expect(snap["status"]).toBe("superseded");
    expect(snap["superseded_by_id"]).toBe(replacement.id);
    expect(snap["correction_reason"]).toContain("Restated");
    expect(rebuilt["supersedes_id"]).toBe(id);
    expect(rebuilt["status"]).toBe("working");
    expect(
      (client.db["recognition_events"] ?? []).some(
        (e) => e["event_type"] === "snapshot_superseded",
      ),
    ).toBe(true);

    await expectHttp(
      () => correctSnapshot(approverCtx, { snapshot_id: replacement.id, reason: "not approved" }),
      "not_approved",
      409,
    );
  });

  it("requires an approver role to correct", async () => {
    const pmCtx = makeCtxSharing(client, PREPARER, ["project_admin"]);
    await expectHttp(
      () => correctSnapshot(pmCtx, { snapshot_id: "any", reason: "no permission here" }),
      "forbidden",
      403,
    );
  });
});

function makeCtxSharing(
  client: ReturnType<typeof createFakeSupabase>,
  userId: string,
  roles: string[],
): Ctx {
  const shared = createFakeSupabase(
    {},
    {
      rpc: {
        has_company_role: (args) => roles.includes(String(args["p_role"])),
        write_audit_log: () => null,
      },
    },
  );
  // Share the SAME row arrays so lifecycle steps compose across actors.
  Object.assign(shared.db, client.db);
  return { user: { id: userId }, supabase: shared } as unknown as Ctx;
}

describe("recognition adjustments", () => {
  const ADJ = {
    project_id: PROJECT,
    effective_period: "2026-06-01",
    kind: "claim" as const,
    amount: 25_000,
    currency_code: "USD",
    reason: "Approved extension of time claim",
  };

  it("prepares, edits under concurrency and blocks edits once decided", async () => {
    const { ctx, client } = makeCtx();
    const { id } = await saveAdjustment(ctx, { ...ADJ });
    const row = (client.db["recognition_adjustments"] ?? []).find((a) => a["id"] === id)!;
    row["row_version"] = 1;
    row["status"] = "draft";

    await saveAdjustment(ctx, { ...ADJ, id, amount: 30_000, row_version: 1 });
    expect(Number(row["amount"])).toBe(30_000);
    expect(row["row_version"]).toBe(2);

    await expectHttp(() => saveAdjustment(ctx, { ...ADJ, id }), "row_version_required", 400);

    row["status"] = "approved";
    await expectHttp(
      () => saveAdjustment(ctx, { ...ADJ, id, row_version: 2 }),
      "version_conflict",
      409,
    );
  });

  it("authorises only by someone other than the preparer, and voids", async () => {
    const { ctx, client } = makeCtx();
    const { id } = await saveAdjustment(ctx, { ...ADJ });
    const row = (client.db["recognition_adjustments"] ?? []).find((a) => a["id"] === id)!;
    row["row_version"] = 1;
    row["status"] = "draft";

    await expectHttp(
      () => decideAdjustment(ctx, { adjustment_id: id, decision: "approve", row_version: 1 }),
      "segregation_of_duties",
      403,
    );

    const approver = makeCtxSharing(client, APPROVER, ["finance_admin"]);
    await decideAdjustment(approver, { adjustment_id: id, decision: "approve", row_version: 1 });
    expect(row["status"]).toBe("approved");
    expect(row["authorized_by"]).toBe(APPROVER);

    await expectHttp(
      () => decideAdjustment(approver, { adjustment_id: id, decision: "void", row_version: 2 }),
      "already_decided",
      409,
    );

    const { id: id2 } = await saveAdjustment(ctx, { ...ADJ, reason: "Duplicate claim entry" });
    const row2 = (client.db["recognition_adjustments"] ?? []).find((a) => a["id"] === id2)!;
    row2["row_version"] = 1;
    row2["status"] = "draft";
    await decideAdjustment(approver, { adjustment_id: id2, decision: "void", row_version: 1 });
    expect(row2["status"]).toBe("voided");
    expect(row2["voided_by"]).toBe(APPROVER);
  });

  it("requires an approver role to decide", async () => {
    const { ctx, client } = makeCtx({ roles: ["project_admin"] });
    const { id } = await saveAdjustment(ctx, { ...ADJ });
    void client;
    await expectHttp(
      () => decideAdjustment(ctx, { adjustment_id: id, decision: "approve", row_version: 1 }),
      "forbidden",
      403,
    );
  });
});

describe("recognition reads: workspace, appendix and alert rows", () => {
  it("loads a workspace with policy, lines, reconciliation and history", async () => {
    const { ctx } = makeCtx();
    await saveObligation(ctx, { ...OBLIGATION });
    await buildSnapshot(ctx, { ...BUILD });

    const ws = await loadRecognitionWorkspace(ctx, PROJECT);
    expect(ws.project_id).toBe(PROJECT);
    expect(ws.project_name).toBe("East Amman");
    expect(ws.snapshot?.status).toBe("working");
    expect(ws.lines.length).toBeGreaterThan(0);
    expect(ws.totals).not.toBeNull();
    expect(ws.reconciliation.length).toBeGreaterThan(0);
    expect(ws.frozen).toBe(false);
    expect(ws.access.canWrite).toBe(true);
    expect(ws.history).toHaveLength(1);
    expect(ws.events.length).toBeGreaterThan(0);
  });

  it("returns an empty-but-valid workspace before any snapshot exists", async () => {
    const { ctx } = makeCtx();
    const ws = await loadRecognitionWorkspace(ctx, PROJECT);
    expect(ws.snapshot).toBeNull();
    expect(ws.lines).toEqual([]);
    expect(ws.totals).toBeNull();
    expect(ws.frozen).toBe(false);
  });

  it("404s on a project outside the caller's company scope", async () => {
    const { ctx } = makeCtx();
    await expectHttp(
      () => loadRecognitionWorkspace(ctx, "99999999-9999-4999-8999-999999999999"),
      "project_not_found",
      404,
    );
  });

  it("marks the appendix indicative and watermarked until approval", async () => {
    const { ctx, client } = makeCtx();
    await saveObligation(ctx, { ...OBLIGATION });
    const { id } = await buildSnapshot(ctx, { ...BUILD });

    const draft = await loadRecognitionAppendix(ctx, PROJECT);
    expect(draft.scope).toBe("project");
    expect(draft.basis).toBe("indicative");
    expect(draft.watermark).toBe("WORKING");
    expect(draft.frozen).toBe(false);
    expect(draft.disclaimer.length).toBeGreaterThan(0);
    expect(draft.obligations.length).toBeGreaterThan(0);

    const snap = (client.db["recognition_snapshots"] ?? []).find((s) => s["id"] === id)!;
    snap["status"] = "approved";
    snap["approved_by"] = APPROVER;
    snap["approved_at"] = "2026-07-05T10:00:00.000Z";

    const approved = await loadRecognitionAppendix(ctx, PROJECT);
    expect(approved.basis).toBe("approved");
    expect(approved.watermark).toBeNull();
    expect(approved.frozen).toBe(true);
    expect(approved.approvals.approved_by).toBe(APPROVER);
  });

  it("reports NO SNAPSHOT in the appendix when nothing has been built", async () => {
    const { ctx } = makeCtx();
    const appendix = await loadRecognitionAppendix(ctx, PROJECT);
    expect(appendix.watermark).toBe("NO SNAPSHOT");
    expect(appendix.totals).toBeNull();
    expect(appendix.obligations).toEqual([]);
  });

  it("feeds the alert register with the latest snapshot per project and governance signals", async () => {
    const { ctx, client } = makeCtx();
    await saveObligation(ctx, { ...OBLIGATION });
    await buildSnapshot(ctx, { ...BUILD });
    await saveAdjustment(ctx, {
      project_id: PROJECT,
      effective_period: "2026-06-01",
      kind: "claim",
      amount: 10_000,
      currency_code: "USD",
      reason: "Pending governance review",
    });
    const adj = client.db["recognition_adjustments"]?.[0] as Record<string, unknown>;
    adj["status"] = "draft";
    adj["company_id"] = COMPANY;

    const rows = await loadRecognitionAlertRows(ctx, COMPANY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_id).toBe(PROJECT);
    expect(rows[0]?.project_name).toBe("East Amman");
    expect(rows[0]?.customer).toBe("NEPCO");
    expect(rows[0]?.period_month).toBe("2026-06-01");
    expect(rows[0]?.pending_adjustments).toBe(1);

    // Period filter narrows the feed and never leaks other months.
    await expect(loadRecognitionAlertRows(ctx, COMPANY, "2026-05-01")).resolves.toEqual([]);
  });

  it("returns no alert rows for a company with no recognition activity", async () => {
    const { ctx } = makeCtx();
    await expect(
      loadRecognitionAlertRows(ctx, "88888888-8888-4888-8888-888888888888"),
    ).resolves.toEqual([]);
  });
});
