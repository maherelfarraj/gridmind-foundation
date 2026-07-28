// P-260 — compliance expiry derivation, alert dedupe, hard gate and scorecard math.
import { describe, expect, it } from "vitest";

import {
  claimAccuracy,
  complianceFingerprint,
  complianceGate,
  complianceStatus,
  complianceWarnings,
  compositeScore,
  computeScorecard,
  dedupeAlerts,
  daysUntil,
  onTimeScore,
  qualityScore,
  safetyScore,
  scoreBand,
  scoreTrend,
  ComplianceDocSaveSchema,
} from "@/lib/sub-compliance.rules";

const AS_OF = "2026-07-28";

describe("expiry status derivation", () => {
  it("derives valid / expiring_soon / expired around the 30-day window", () => {
    expect(complianceStatus("2026-09-30", AS_OF)).toBe("valid");
    expect(complianceStatus("2026-08-27", AS_OF)).toBe("expiring_soon"); // 30 days
    expect(complianceStatus("2026-08-28", AS_OF)).toBe("valid"); // 31 days
    expect(complianceStatus(AS_OF, AS_OF)).toBe("expiring_soon"); // expires today
    expect(complianceStatus("2026-07-27", AS_OF)).toBe("expired");
  });

  it("counts whole days to expiry", () => {
    expect(daysUntil("2026-07-28", AS_OF)).toBe(0);
    expect(daysUntil("2026-08-07", AS_OF)).toBe(10);
    expect(daysUntil("2026-07-18", AS_OF)).toBe(-10);
  });

  it("flags only non-valid docs as warnings", () => {
    const warnings = complianceWarnings(
      [
        { id: "a", doc_type: "insurance", mandatory: true, expiry_date: "2026-12-01" },
        { id: "b", doc_type: "license", mandatory: false, expiry_date: "2026-08-05" },
        { id: "c", doc_type: "safety_cert", mandatory: false, expiry_date: "2026-01-01" },
      ],
      AS_OF,
    );
    expect(warnings).toEqual([
      { id: "b", status: "expiring_soon" },
      { id: "c", status: "expired" },
    ]);
  });
});

describe("fingerprint dedupe (the Day-5 no-double-crying lesson)", () => {
  it("is stable for the same doc/state/expiry and changes when any part changes", () => {
    const base = { id: "d1", status: "expiring_soon" as const, expiry_date: "2026-08-10" };
    expect(complianceFingerprint(base)).toBe(complianceFingerprint({ ...base }));
    expect(complianceFingerprint({ ...base, status: "expired" })).not.toBe(
      complianceFingerprint(base),
    );
    expect(complianceFingerprint({ ...base, expiry_date: "2026-09-10" })).not.toBe(
      complianceFingerprint(base),
    );
  });

  it("emits one alert per fingerprint across repeated sweeps", () => {
    const docs = [
      { id: "d1", status: "expiring_soon" as const, expiry_date: "2026-08-10" },
      { id: "d1", status: "expiring_soon" as const, expiry_date: "2026-08-10" },
      { id: "d2", status: "expired" as const, expiry_date: "2026-01-01" },
    ];
    expect(dedupeAlerts(docs)).toHaveLength(2);
    // a renewal changes the expiry -> a new, legitimate alert
    expect(
      dedupeAlerts([...docs, { id: "d1", status: "expiring_soon", expiry_date: "2027-08-10" }]),
    ).toHaveLength(3);
  });
});

describe("hard gate: expired mandatory insurance blocks claims", () => {
  const SC = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";

  it("blocks on an expired mandatory insurance covering the subcontract", () => {
    expect(
      complianceGate(
        [{ doc_type: "insurance", mandatory: true, expiry_date: "2026-01-01", subcontract_id: SC }],
        SC,
        AS_OF,
      ),
    ).toBe("compliance_insurance_expired");
  });

  it("blocks on an expired vendor-level (umbrella) insurance", () => {
    expect(
      complianceGate(
        [
          {
            doc_type: "insurance",
            mandatory: true,
            expiry_date: "2026-01-01",
            subcontract_id: null,
          },
        ],
        SC,
        AS_OF,
      ),
    ).toBe("compliance_insurance_expired");
  });

  it("does not block on another subcontract's expired insurance", () => {
    expect(
      complianceGate(
        [
          {
            doc_type: "insurance",
            mandatory: true,
            expiry_date: "2026-01-01",
            subcontract_id: OTHER,
          },
        ],
        SC,
        AS_OF,
      ),
    ).toBeNull();
  });

  it("does not block on expiring-soon, non-mandatory or non-insurance expiry", () => {
    expect(
      complianceGate(
        [
          { doc_type: "insurance", mandatory: true, expiry_date: "2026-08-05" },
          { doc_type: "insurance", mandatory: false, expiry_date: "2026-01-01" },
          { doc_type: "license", mandatory: true, expiry_date: "2026-01-01" },
        ],
        SC,
        AS_OF,
      ),
    ).toBeNull();
  });
});

describe("scorecard math", () => {
  const claims = [
    { claimed: 100_000, certified: 100_000, period_end: "2026-05-31", submitted_at: "2026-06-03" },
    { claimed: 100_000, certified: 90_000, period_end: "2026-06-30", submitted_at: "2026-07-12" },
  ];

  it("scores claim accuracy from certified-vs-claimed variance", () => {
    expect(claimAccuracy(claims)).toBe(95);
    expect(claimAccuracy([])).toBeNull();
    // over-claiming is penalised symmetrically
    expect(
      claimAccuracy([
        { claimed: 200_000, certified: 100_000, period_end: "2026-06-30", submitted_at: null },
      ]),
    ).toBe(50);
  });

  it("penalises safety incidents by severity and floors at zero", () => {
    expect(safetyScore([])).toBe(100);
    expect(safetyScore([{ severity: "near_miss" }])).toBeLessThan(100);
    expect(safetyScore([{ severity: "fatality" }])).toBe(0);
    expect(safetyScore([], false)).toBeNull();
  });

  it("penalises NCRs raised against the sub's packages", () => {
    expect(qualityScore([])).toBe(100);
    expect(qualityScore([{ severity: "critical" }])!).toBeLessThan(
      qualityScore([{ severity: "minor" }])!,
    );
    expect(qualityScore([], false)).toBeNull();
  });

  it("scores on-time submission with the grace window", () => {
    expect(onTimeScore(claims)).toBe(50); // one inside grace, one late
    expect(onTimeScore([])).toBeNull();
  });

  it("weights the composite and ignores missing components", () => {
    const full = compositeScore({
      claim_accuracy: 95,
      safety_score: 100,
      quality_score: 80,
      on_time_score: 50,
    });
    expect(full).not.toBeNull();
    expect(full!).toBeGreaterThan(50);
    expect(full!).toBeLessThan(100);
    expect(compositeScore({ claim_accuracy: 90 })).toBe(90);
    expect(compositeScore({})).toBeNull();
  });

  it("computes an end-to-end scorecard fixture", () => {
    const card = computeScorecard({
      claims,
      incidents: [{ severity: "near_miss" }],
      ncrs: [{ severity: "minor" }],
    });
    expect(card.claim_accuracy).toBe(95);
    expect(card.safety_score).toBeLessThan(100);
    expect(card.quality_score).toBeLessThan(100);
    expect(card.on_time_score).toBe(50);
    expect(card.composite).toBeGreaterThan(0);
    expect(card.composite).toBeLessThanOrEqual(100);
  });

  it("reports trend and band", () => {
    expect(scoreTrend(88, 80)).toEqual({ delta: 8, direction: "up" });
    expect(scoreTrend(80, 88)).toEqual({ delta: -8, direction: "down" });
    expect(scoreTrend(80, 80)!.direction).toBe("flat");
    expect(scoreTrend(80, null)).toBeNull();
    expect(scoreBand(90)).toBe("green");
    expect(scoreBand(75)).toBe("amber");
    expect(scoreBand(10)).toBe("destructive");
    expect(scoreBand(null)).toBeNull();
  });
});

describe("compliance doc validation", () => {
  const VENDOR = "33333333-3333-3333-3333-333333333333";

  it("accepts a well-formed document", () => {
    const parsed = ComplianceDocSaveSchema.parse({
      vendor_id: VENDOR,
      doc_type: "insurance",
      title: "CAR policy 2026",
      expiry_date: "2027-01-01",
      issue_date: "2026-01-01",
      mandatory: true,
    });
    expect(parsed.doc_type).toBe("insurance");
  });

  it("rejects unknown doc types and expiry before issue", () => {
    expect(() =>
      ComplianceDocSaveSchema.parse({
        vendor_id: VENDOR,
        doc_type: "nonsense",
        title: "x y",
        expiry_date: "2027-01-01",
      }),
    ).toThrow();
    expect(() =>
      ComplianceDocSaveSchema.parse({
        vendor_id: VENDOR,
        doc_type: "license",
        title: "Trade licence",
        issue_date: "2027-02-01",
        expiry_date: "2027-01-01",
      }),
    ).toThrow();
  });
});
