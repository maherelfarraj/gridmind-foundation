// P-214 — BOM snapshot import: traceability + direct-cost reconciliation.
import { describe, expect, it } from "vitest";

import { importBomSnapshot, recomputeDirectCost } from "@/lib/estimating.server";
import { COMPANY_A, makeBomLine, makeEstimate, makeWorld } from "./fixtures";

const SNAPSHOT = [
  makeBomLine({ id: "bom-1", item: "PV module 580 Wp", qty_buffered: 10, unit_cost: 120 }),
  makeBomLine({
    id: "bom-2",
    item: "String inverter",
    spec: null,
    qty_buffered: 4,
    unit: "pc",
    unit_cost: 2500.005,
    category: "inverters",
  }),
  makeBomLine({
    id: "bom-3",
    item: "DC cable",
    spec: "6 mm²",
    qty_buffered: 1200,
    unit: "m",
    unit_cost: null,
    category: "cables",
  }),
];

function world() {
  return makeWorld({
    estimates: [makeEstimate({ direct_cost: 0, subtotal: 0, total_price: 0 })],
    bom_lines: SNAPSHOT,
    estimate_lines: [],
  });
}

describe("BOM import", () => {
  it("copies every BOM line with traceability and derived amounts", async () => {
    const w = world();
    const imported = await importBomSnapshot(w.ctx, {
      companyId: COMPANY_A,
      estimateId: "est-1",
      snapshotId: "snap-1",
    });
    expect(imported).toBe(3);
    const lines = w.db.estimate_lines;
    expect(lines.map((l) => l.source_bom_line_id)).toEqual(["bom-1", "bom-2", "bom-3"]);
    expect(lines.map((l) => l.line_type)).toEqual(["material", "material", "material"]);
    expect(lines.map((l) => l.sort_order)).toEqual([0, 1, 2]);
    expect(lines.map((l) => l.qty)).toEqual([10, 4, 1200]);
    expect(lines.map((l) => l.unit_rate)).toEqual([120, 2500.005, 0]);
    expect(lines.map((l) => l.amount)).toEqual([1200, 10_000.02, 0]);
    expect(lines.every((l) => l.company_id === COMPANY_A && l.estimate_id === "est-1")).toBe(true);
  });

  it("reconciles direct_cost with the sum of imported amounts", async () => {
    const w = world();
    await importBomSnapshot(w.ctx, {
      companyId: COMPANY_A,
      estimateId: "est-1",
      snapshotId: "snap-1",
    });
    const direct = await recomputeDirectCost(w.ctx, "est-1");
    const sum = w.db.estimate_lines.reduce((a, l) => a + Number(l.amount), 0);
    expect(direct).toBe(11_200.02);
    expect(direct).toBe(Math.round(sum * 100) / 100);
    expect(w.db.estimates[0].direct_cost).toBe(direct);
  });

  it("imports nothing for a blank create (no snapshot rows)", async () => {
    const w = makeWorld({ estimates: [makeEstimate()], bom_lines: [], estimate_lines: [] });
    const imported = await importBomSnapshot(w.ctx, {
      companyId: COMPANY_A,
      estimateId: "est-1",
      snapshotId: "snap-empty",
    });
    expect(imported).toBe(0);
    expect(w.db.estimate_lines).toHaveLength(0);
  });
});
