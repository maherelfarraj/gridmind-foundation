// P-157 — waterfall reconciles the persisted loss chain from gross to net.
import { describe, expect, it } from "vitest";

import { waterfallData, type LossStepRow } from "@/components/engineering/pv-simulation-results";

function step(i: number, label: string, energy: number, loss: number): LossStepRow {
  return {
    index: i,
    step: `s${i}`,
    label,
    formula: "x",
    inputs: {},
    input_sources: {},
    loss_pct: loss,
    energy_kwh: energy,
    monthly_kwh: [],
  };
}

describe("waterfallData", () => {
  const chain = [
    step(1, "POA", 1000, 0),
    step(2, "Temperature", 950, 5),
    step(3, "Soiling", 931, 2),
  ];

  it("starts at gross and ends at net", () => {
    const rows = waterfallData(chain);
    expect(rows[0]).toMatchObject({ name: "Gross", base: 0, delta: 1000 });
    expect(rows.at(-1)).toMatchObject({ name: "Net", base: 0, delta: 931 });
  });

  it("keeps the persisted order and reconciles each drop", () => {
    const rows = waterfallData(chain);
    expect(rows.map((r) => r.name)).toEqual(["Gross", "Temperature", "Soiling", "Net"]);
    expect(rows[1]).toMatchObject({ base: 950, delta: 50 });
    expect(rows[2]).toMatchObject({ base: 931, delta: 19 });
    const net = rows[0].delta - rows.slice(1, -1).reduce((a, r) => a + r.delta, 0);
    expect(net).toBe(rows.at(-1)!.delta);
  });

  it("returns nothing for an empty chain", () => {
    expect(waterfallData([])).toEqual([]);
  });
});
