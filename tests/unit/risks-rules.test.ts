// P-074 — Unit tests for risk register rules.
import { describe, expect, it } from "vitest";

import {
  allowedStatusTransitions,
  bandForAge,
  bandForScore,
  heatCellClass,
  matrixCells,
  registerAgeDays,
  riskCreateSchema,
  scoreOf,
  sumContingency,
} from "@/lib/risks.rules";

describe("scoreOf + bandForScore", () => {
  it("multiplies within bounds", () => {
    expect(scoreOf(4, 4)).toBe(16);
    expect(scoreOf(3, 3)).toBe(9);
    expect(scoreOf(2, 3)).toBe(6);
  });
  it("bands correctly", () => {
    expect(bandForScore(4)).toBe("low");
    expect(bandForScore(5)).toBe("medium");
    expect(bandForScore(9)).toBe("medium");
    expect(bandForScore(10)).toBe("high");
    expect(bandForScore(14)).toBe("high");
    expect(bandForScore(15)).toBe("critical");
    expect(bandForScore(25)).toBe("critical");
  });
});

describe("registerAgeDays + bandForAge", () => {
  it("returns null when empty", () => {
    expect(registerAgeDays([])).toBeNull();
  });
  it("uses newest identified_at", () => {
    const today = new Date("2026-08-01");
    expect(
      registerAgeDays(
        [
          { identified_at: "2026-07-25" },
          { identified_at: "2026-06-01" },
          { identified_at: "2026-07-30" },
        ],
        today,
      ),
    ).toBe(2);
  });
  it("bands green/amber/destructive", () => {
    expect(bandForAge(null)).toBe("ok");
    expect(bandForAge(0)).toBe("ok");
    expect(bandForAge(14)).toBe("ok");
    expect(bandForAge(15)).toBe("warning");
    expect(bandForAge(30)).toBe("warning");
    expect(bandForAge(31)).toBe("destructive");
  });
});

describe("matrixCells", () => {
  it("buckets by probability/impact", () => {
    const cells = matrixCells([
      { probability: 4, impact: 4, id: "a" },
      { probability: 4, impact: 4, id: "b" },
      { probability: 2, impact: 3, id: "c" },
    ]);
    expect(cells.get("4-4")!.map((c) => c.id)).toEqual(["a", "b"]);
    expect(cells.get("2-3")!.map((c) => c.id)).toEqual(["c"]);
    expect(cells.get("1-1")).toBeUndefined();
  });
});

describe("heatCellClass", () => {
  it("returns only semantic-token classes", () => {
    const seen = new Set<string>();
    for (let p = 1; p <= 5; p++)
      for (let i = 1; i <= 5; i++) seen.add(heatCellClass(p, i));
    for (const cls of seen) {
      expect(cls.startsWith("bg-")).toBe(true);
      expect(cls).not.toMatch(/#|rgb|\[/);
    }
  });
  it("escalates by score", () => {
    expect(heatCellClass(1, 1)).toBe("bg-muted/40");
    expect(heatCellClass(3, 2)).toBe("bg-primary/10");
    expect(heatCellClass(3, 3)).toBe("bg-warning/15");
    expect(heatCellClass(4, 4)).toBe("bg-destructive/15");
    expect(heatCellClass(5, 5)).toBe("bg-destructive/25");
  });
});

describe("sumContingency", () => {
  it("excludes realized and closed", () => {
    const r = sumContingency([
      {
        status: "open",
        contingency_amount: 100,
        currency_code: "USD",
      },
      {
        status: "mitigating",
        contingency_amount: 50,
        currency_code: "USD",
      },
      {
        status: "closed",
        contingency_amount: 999,
        currency_code: "USD",
      },
      {
        status: "realized",
        contingency_amount: 999,
        currency_code: "USD",
      },
    ]);
    expect(r.primary).toEqual({ code: "USD", amount: 150 });
    expect(r.otherCount).toBe(0);
  });
  it("splits by currency and returns primary + others", () => {
    const r = sumContingency([
      { status: "open", contingency_amount: 100, currency_code: "USD" },
      { status: "open", contingency_amount: 1000, currency_code: "EUR" },
      { status: "open", contingency_amount: 50, currency_code: "GBP" },
    ]);
    expect(r.primary?.code).toBe("EUR");
    expect(r.otherCount).toBe(2);
  });
  it("returns null primary when nothing to sum", () => {
    const r = sumContingency([]);
    expect(r.primary).toBeNull();
  });
});

describe("allowedStatusTransitions", () => {
  it("open can go anywhere", () => {
    expect(allowedStatusTransitions("open")).toContain("closed");
  });
  it("closed can reopen", () => {
    expect(allowedStatusTransitions("closed")).toContain("open");
  });
  it("realized narrows to closed only", () => {
    expect(allowedStatusTransitions("realized")).toEqual(["realized", "closed"]);
  });
});

describe("riskCreateSchema", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    title: "Grid delay",
    category: "schedule" as const,
    probability: 4,
    impact: 4,
    status: "open" as const,
  };
  it("accepts a minimal risk", () => {
    expect(riskCreateSchema.safeParse(base).success).toBe(true);
  });
  it("rejects empty title", () => {
    expect(
      riskCreateSchema.safeParse({ ...base, title: "  " }).success,
    ).toBe(false);
  });
  it("rejects invalid category", () => {
    expect(
      riskCreateSchema.safeParse({ ...base, category: "other" as any })
        .success,
    ).toBe(false);
  });
  it("rejects out-of-range probability", () => {
    expect(
      riskCreateSchema.safeParse({ ...base, probability: 6 }).success,
    ).toBe(false);
  });
  it("rejects negative contingency", () => {
    expect(
      riskCreateSchema.safeParse({ ...base, contingency_amount: -1 }).success,
    ).toBe(false);
  });
  it("rejects malformed currency", () => {
    expect(
      riskCreateSchema.safeParse({ ...base, currency_code: "us$" }).success,
    ).toBe(false);
  });
});
