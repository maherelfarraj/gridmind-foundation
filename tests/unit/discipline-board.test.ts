// P-085 — Discipline board rollup tests.
import { describe, expect, it } from "vitest";
import {
  isoWeekStart,
  normalizeDiscipline,
  parseQuantities,
  rollupBoard,
  spiCpiTone,
  trendFor,
  type DprQuantity,
  type RollupInputWbs,
} from "../../src/lib/discipline-board.rules";

describe("normalizeDiscipline", () => {
  it("maps common labels", () => {
    expect(normalizeDiscipline("Civil")).toBe("civil");
    expect(normalizeDiscipline("mech")).toBe("mechanical");
    expect(normalizeDiscipline("Electrical")).toBe("electrical");
    expect(normalizeDiscipline("I&C")).toBe("electrical");
    expect(normalizeDiscipline("hse")).toBeNull();
    expect(normalizeDiscipline(null)).toBeNull();
  });
});

describe("parseQuantities", () => {
  it("drops malformed rows", () => {
    const q = parseQuantities(
      [
        { wbs_item_id: "w1", discipline: "civil", area: "A", qty: 10, uom: "piles" },
        { discipline: "civil", area: "A", qty: "bad" },
        null,
        "string",
      ],
      "2026-07-20",
    );
    expect(q).toHaveLength(1);
    expect(q[0].qty).toBe(10);
    expect(q[0].report_date).toBe("2026-07-20");
  });
});

const WBS: RollupInputWbs[] = [
  {
    id: "w1",
    name: "Pile foundations",
    discipline: "civil",
    area: "Block A",
    uom: "piles",
    planned_quantity: 100,
  },
  {
    id: "w2",
    name: "Trackers",
    discipline: "mechanical",
    area: "Block B",
    uom: "trackers",
    planned_quantity: null,
  },
];

function q(date: string, wbs: string, qty: number, disc = "civil", area = "Block A"): DprQuantity {
  return { report_date: date, wbs_item_id: wbs, discipline: disc, area, qty, uom: null };
}

describe("rollupBoard", () => {
  const today = "2026-07-25";

  it("computes progress and 7d rate with trend vs prior week", () => {
    const quantities: DprQuantity[] = [
      // current week
      q("2026-07-25", "w1", 10),
      q("2026-07-24", "w1", 10),
      q("2026-07-23", "w1", 20),
      // prior week
      q("2026-07-18", "w1", 5),
      q("2026-07-17", "w1", 5),
    ];
    const cols = rollupBoard(quantities, WBS, { today });
    const civil = cols.find((c) => c.discipline === "civil")!;
    expect(civil.areas).toHaveLength(1);
    const a = civil.areas[0];
    expect(a.installedToDate).toBe(50);
    expect(a.plannedQty).toBe(100);
    expect(a.progressPct).toBe(50);
    // 3 reporting days in current window, avg = 40/3
    expect(a.rate7d).toBeCloseTo(40 / 3, 5);
    // 2 reporting days prior, avg = 10/2 = 5
    expect(a.ratePrev7d).toBe(5);
    expect(trendFor(a.rate7d, a.ratePrev7d)).toBe("up");
  });

  it("returns null progress and 'no baseline' when planned_quantity missing", () => {
    const cols = rollupBoard([q("2026-07-25", "w2", 3, "mechanical", "Block B")], WBS, {
      today,
    });
    const mech = cols.find((c) => c.discipline === "mechanical")!;
    expect(mech.areas[0].plannedQty).toBeNull();
    expect(mech.areas[0].progressPct).toBeNull();
    expect(mech.areas[0].installedToDate).toBe(3);
  });

  it("keeps all three columns in stable order and drops non-board disciplines", () => {
    const cols = rollupBoard(
      [q("2026-07-25", "w1", 1, "hse", "X"), q("2026-07-25", "w1", 2, "civil")],
      WBS,
      { today },
    );
    expect(cols.map((c) => c.discipline)).toEqual(["civil", "mechanical", "electrical"]);
    expect(cols[1].areas).toEqual([]);
    expect(cols[2].areas).toEqual([]);
  });
});

describe("spiCpiTone", () => {
  it("thresholds", () => {
    expect(spiCpiTone(null)).toBe("muted");
    expect(spiCpiTone(1.05)).toBe("success");
    expect(spiCpiTone(0.95)).toBe("warning");
    expect(spiCpiTone(0.85)).toBe("destructive");
  });
});

describe("isoWeekStart", () => {
  it("returns the previous Sunday", () => {
    // 2026-07-25 is a Saturday → week start is 2026-07-19
    expect(isoWeekStart("2026-07-25")).toBe("2026-07-19");
    // Sunday returns itself
    expect(isoWeekStart("2026-07-19")).toBe("2026-07-19");
  });
});
