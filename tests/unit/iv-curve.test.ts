import { describe, it, expect } from "vitest";
import { computeIvSummary } from "@/lib/commissioning.functions";

describe("computeIvSummary", () => {
  it("returns null for < 2 points", () => {
    expect(computeIvSummary([])).toBeNull();
    expect(computeIvSummary([{ voltageV: 0, currentA: 8 }])).toBeNull();
  });

  it("computes Voc, Isc, Pmax and FF for a typical IV curve", () => {
    // Rough single-module IV: Isc≈8.2A, Voc≈40V, Pmax≈260W at V=32,I=8.1
    const points = [
      { voltageV: 0, currentA: 8.2 },
      { voltageV: 10, currentA: 8.18 },
      { voltageV: 20, currentA: 8.15 },
      { voltageV: 30, currentA: 8.1 },
      { voltageV: 32, currentA: 8.05 },
      { voltageV: 36, currentA: 6.5 },
      { voltageV: 39, currentA: 2.5 },
      { voltageV: 40, currentA: 0 },
    ];
    const s = computeIvSummary(points)!;
    expect(s).not.toBeNull();
    expect(s.voc).toBeCloseTo(40, 3);
    expect(s.isc).toBeCloseTo(8.2, 3);
    // Pmax = max(V*I) — at V=32, P = 32*8.05 = 257.6
    expect(s.pmax).toBeCloseTo(257.6, 2);
    // FF = 257.6 / (40 * 8.2) = 0.7854
    expect(s.ff).toBeCloseTo(257.6 / (40 * 8.2), 3);
  });

  it("interpolates Voc when I doesn't hit zero exactly", () => {
    const s = computeIvSummary([
      { voltageV: 0, currentA: 5 },
      { voltageV: 10, currentA: 1 },
      { voltageV: 12, currentA: -1 },
    ])!;
    // linear between (10,1) and (12,-1) → V=11 at I=0
    expect(s.voc).toBeCloseTo(11, 3);
  });
});
