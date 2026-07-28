// P-262 — Subcontract lifecycle aggregation fixture suite.
//
// $100,000 subcontract, three claims at 40 / 35 / 25 %, 10 % retention on each,
// certification through the approval engine, an AP invoice per certified claim,
// then a full retention release that zeroes the ledger. Every number is
// hand-computed in `EXPECTED` (tests/subcontracts/fixtures.ts) and asserted to
// the cent — the awkward SOV split (60,000.00 / 33,333.33 / 6,666.67) makes
// rounding drift impossible to hide.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadCertifiedSubcontractActuals } from "@/lib/subcontract-actuals.server";
import { apDueDate, isApInvoiceNumber, retentionLedger } from "@/lib/subcontract-finance.rules";

import {
  certifyClaim,
  daysFromToday,
  EXPECTED,
  isSupabaseUp,
  rpc,
  setupSubcontractFixture,
  submitClaim,
  type SubcontractFixture,
  tenantExists,
  tenantSurvivors,
  today,
} from "./fixtures";

const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

const n = (v: unknown): number => Number(v ?? 0);

d("P-262 · subcontract lifecycle — $100k, 3 claims, retention to the cent", () => {
  let fx: SubcontractFixture;
  const claimIds: string[] = [];
  let purged = false;

  beforeAll(async () => {
    fx = await setupSubcontractFixture();
  }, 180_000);

  afterAll(async () => {
    if (!fx) return;
    await fx.cleanup();
    purged = true;
    // Teardown doctrine: the fixture tenant is gone, the protected ones survive.
    expect(await tenantExists(fx.svc, fx.companyId)).toBe(false);
    expect(await tenantSurvivors(fx.svc)).toEqual(["gsi", "sandbox"]);
  }, 180_000);

  it("SOV lines reconcile to the contract value to the cent", async () => {
    const { data } = await fx.svc
      .from("subcontract_lines")
      .select("amount")
      .eq("subcontract_id", fx.subA.id);
    const total = ((data ?? []) as { amount: number }[]).reduce((a, r) => a + n(r.amount), 0);
    expect(Math.round(total * 100)).toBe(Math.round(EXPECTED.contractValue * 100));
  });

  for (const [index, exp] of EXPECTED.claims.entries()) {
    it(`claim ${index + 1} (${exp.pct}%) derives lines, retention and net payable exactly`, async () => {
      const claimId = await submitClaim(fx.svc, {
        companyId: fx.companyId,
        subcontractId: fx.subA.id,
        lineIds: fx.subA.lineIds,
        pct: exp.pct,
        periodStart: daysFromToday(-30 + index),
        periodEnd: daysFromToday(-1 + index),
        userId: fx.admin.userId,
      });
      claimIds.push(claimId);

      const { data: lines } = await fx.svc
        .from("subcontract_claim_lines")
        .select("subcontract_line_id, previous_pct, cumulative_pct, this_period_amount")
        .eq("claim_id", claimId);
      const byLine = new Map(
        ((lines ?? []) as Record<string, unknown>[]).map((r) => [String(r.subcontract_line_id), r]),
      );
      fx.subA.lineIds.forEach((id, i) => {
        const row = byLine.get(id)!;
        expect(n(row.this_period_amount), `line ${i + 1} this period`).toBe(exp.lines[i]);
        expect(n(row.cumulative_pct)).toBe(
          EXPECTED.claims.slice(0, index + 1).reduce((a, c) => a + c.pct, 0),
        );
      });

      const { data: claim } = await fx.svc
        .from("subcontract_claims")
        .select(
          "status, previous_certified, this_period_amount, gross_to_date, retention_amount, net_payable",
        )
        .eq("id", claimId)
        .single();
      const c = claim as Record<string, unknown>;
      expect(c.status).toBe("submitted");
      expect(n(c.previous_certified)).toBe(exp.previousCertified);
      expect(n(c.this_period_amount)).toBe(exp.thisPeriod);
      expect(n(c.gross_to_date)).toBe(exp.grossToDate);
      expect(n(c.retention_amount)).toBe(exp.retention);
      expect(n(c.net_payable)).toBe(exp.netPayable);
    });

    it(`claim ${index + 1} certification raises AP-#### for the net payable and moves the ledger`, async () => {
      const claimId = claimIds[index];
      await certifyClaim(fx.svc, {
        companyId: fx.companyId,
        claimId,
        deciderId: fx.admin.userId,
      });

      const { data: claim } = await fx.svc
        .from("subcontract_claims")
        .select("status, certified_at, invoice_id")
        .eq("id", claimId)
        .single();
      const c = claim as Record<string, unknown>;
      expect(c.status).toBe("certified");
      expect(c.invoice_id).toBeTruthy();

      const { data: invoice } = await fx.svc
        .from("invoices")
        .select("invoice_number, direction, status, amount, issue_date, due_date, subcontract_id")
        .eq("id", String(c.invoice_id))
        .single();
      const inv = invoice as Record<string, unknown>;
      expect(isApInvoiceNumber(String(inv.invoice_number))).toBe(true);
      expect(inv.direction).toBe("payable");
      expect(inv.status).toBe("approved");
      expect(n(inv.amount)).toBe(exp.netPayable); // retention never rides the invoice
      expect(inv.subcontract_id).toBe(fx.subA.id);
      expect(inv.due_date).toBe(apDueDate(String(inv.issue_date), EXPECTED.paymentTermsDays));

      const { data: sc } = await fx.svc
        .from("subcontracts")
        .select("certified_to_date, retention_held, retention_released")
        .eq("id", fx.subA.id)
        .single();
      const s = sc as Record<string, unknown>;
      expect(n(s.certified_to_date)).toBe(exp.certifiedToDateAfter);
      expect(n(s.retention_held)).toBe(exp.retentionHeldAfter);
      expect(n(s.retention_released)).toBe(0);
    });
  }

  it("a fourth claim cannot push a line past 100 % cumulative", async () => {
    await expect(
      submitClaim(fx.svc, {
        companyId: fx.companyId,
        subcontractId: fx.subA.id,
        lineIds: fx.subA.lineIds,
        pct: 1,
        periodStart: daysFromToday(0),
        periodEnd: daysFromToday(1),
        userId: fx.admin.userId,
      }),
    ).rejects.toThrow(/claim_cumulative_out_of_range/);
  });

  it("certified sub claims flow into project actual cost (EVM/WIP reflection)", async () => {
    const actuals = await loadCertifiedSubcontractActuals(fx.svc, fx.projectId, today());
    expect(actuals).toBe(EXPECTED.evmActuals);
  });

  it("the retention release zeroes the ledger and raises its own AP invoice", async () => {
    const ledgerBefore = retentionLedger({
      certifiedRetention: EXPECTED.claims.map((c) => c.retention),
      releases: [],
    });
    expect(ledgerBefore.held).toBe(EXPECTED.retention.retained);

    const { data, error } = await rpc(fx.admin.client)("subcontract_release_retention", {
      p_subcontract_id: fx.subA.id,
      p_amount: EXPECTED.retention.release,
      p_release_date: today(),
      p_reason: "P-262 defects liability period ended",
    });
    expect(error).toBeNull();
    const res = (data ?? {}) as Record<string, unknown>;
    expect(n(res.amount)).toBe(EXPECTED.retention.release);
    expect(n(res.retention_held)).toBe(EXPECTED.retention.heldAfterRelease);
    expect(n(res.retention_released)).toBe(EXPECTED.retention.release);
    expect(isApInvoiceNumber(String(res.invoice_number))).toBe(true);

    const { data: inv } = await fx.svc
      .from("invoices")
      .select("amount, direction, status")
      .eq("id", String(res.invoice_id))
      .single();
    expect(n((inv as Record<string, unknown>).amount)).toBe(EXPECTED.retention.release);
    expect((inv as Record<string, unknown>).direction).toBe("payable");

    const { data: sc } = await fx.svc
      .from("subcontracts")
      .select("retention_held, retention_released, certified_to_date")
      .eq("id", fx.subA.id)
      .single();
    const s = sc as Record<string, unknown>;
    expect(n(s.retention_held)).toBe(0);
    expect(n(s.retention_released)).toBe(EXPECTED.retention.release);
    expect(n(s.certified_to_date)).toBe(EXPECTED.contractValue);

    // retained − released = 0 at the end of the life cycle.
    const ledgerAfter = retentionLedger({
      certifiedRetention: EXPECTED.claims.map((c) => c.retention),
      releases: [EXPECTED.retention.release],
    });
    expect(ledgerAfter.held).toBe(0);
    expect(ledgerAfter.fullyReleased).toBe(true);
  });

  it("a release beyond the held balance is refused", async () => {
    const { error } = await rpc(fx.admin.client)("subcontract_release_retention", {
      p_subcontract_id: fx.subA.id,
      p_amount: 1,
      p_release_date: today(),
      p_reason: "nothing left to release",
    });
    expect(error?.message ?? "").toMatch(/retention_release_exceeds_held/);
  });

  it("the AP invoice total equals the sum of every net payable plus the release", async () => {
    const { data } = await fx.svc
      .from("invoices")
      .select("amount")
      .eq("subcontract_id", fx.subA.id)
      .eq("direction", "payable");
    const rows = (data ?? []) as { amount: number }[];
    expect(rows).toHaveLength(EXPECTED.claims.length + 1);
    const total = rows.reduce((a, r) => a + Math.round(n(r.amount) * 100), 0) / 100;
    const want = EXPECTED.claims.reduce((a, c) => a + c.netPayable, 0) + EXPECTED.retention.release;
    expect(total).toBe(want);
    expect(total).toBe(EXPECTED.contractValue);
    expect(purged).toBe(false);
  });
});
