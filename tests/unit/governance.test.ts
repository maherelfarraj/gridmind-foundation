// P-182 — Construction governance pure-logic tests: numbering, revision bump,
// permit validity/expiry sweep, and schema guards.
import { describe, expect, it } from "vitest";

import {
  evaluatePtwValidity,
  formatGovNumber,
  nextGovSequence,
  nextRevision,
  permitCreateSchema,
  technicalQueryAnswerSchema,
  technicalQuerySchema,
  toolboxTalkSchema,
} from "@/lib/governance.rules";

const UUID = "00000000-0000-4000-8000-000000000001";
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const HOUR = 3_600_000;

describe("governance numbering", () => {
  it("zero-pads to four digits per prefix", () => {
    expect(formatGovNumber("MS", 1)).toBe("MS-0001");
    expect(formatGovNumber("PTW", 42)).toBe("PTW-0042");
    expect(formatGovNumber("TQ", 1234)).toBe("TQ-1234");
  });

  it("continues from the highest existing sequence", () => {
    expect(nextGovSequence("SI", [])).toBe(1);
    expect(nextGovSequence("SI", ["SI-0001", "SI-0009", "SI-0003"])).toBe(10);
  });

  it("ignores numbers belonging to another prefix", () => {
    expect(nextGovSequence("TBT", ["MS-0099", "TBT-0002"])).toBe(3);
  });
});

describe("nextRevision", () => {
  it("walks the R-ladder", () => {
    expect(nextRevision("R0")).toBe("R1");
    expect(nextRevision("R9")).toBe("R10");
    expect(nextRevision("r3")).toBe("R4");
  });

  it("restarts at R1 for unrecognised labels", () => {
    expect(nextRevision("")).toBe("R1");
    expect(nextRevision("Rev A")).toBe("R1");
  });
});

describe("evaluatePtwValidity", () => {
  const base = {
    status: "active" as const,
    validFrom: iso(NOW - HOUR),
    validTo: iso(NOW + HOUR),
    isolationsConfirmed: true,
  };

  it("is usable when active, in window and isolated", () => {
    const v = evaluatePtwValidity(base, NOW);
    expect(v.usable).toBe(true);
    expect(v.effectiveStatus).toBe("active");
    expect(v.needsExpirySweep).toBe(false);
  });

  it("is unusable before valid_from", () => {
    const v = evaluatePtwValidity({ ...base, validFrom: iso(NOW + HOUR / 2) }, NOW);
    expect(v.usable).toBe(false);
    expect(v.reason).toMatch(/not yet/);
  });

  it("sweeps to expired once valid_to passes", () => {
    const v = evaluatePtwValidity({ ...base, validTo: iso(NOW - 1) }, NOW);
    expect(v.effectiveStatus).toBe("expired");
    expect(v.needsExpirySweep).toBe(true);
    expect(v.usable).toBe(false);
  });

  it("treats valid_to as exclusive at the boundary", () => {
    expect(evaluatePtwValidity({ ...base, validTo: iso(NOW) }, NOW).usable).toBe(false);
  });

  it("does not sweep closed or cancelled permits", () => {
    const v = evaluatePtwValidity({ ...base, status: "closed", validTo: iso(NOW - HOUR) }, NOW);
    expect(v.needsExpirySweep).toBe(false);
    expect(v.effectiveStatus).toBe("closed");
  });

  it("is unusable while isolations are unconfirmed", () => {
    const v = evaluatePtwValidity({ ...base, isolationsConfirmed: false }, NOW);
    expect(v.usable).toBe(false);
    expect(v.reason).toMatch(/Isolations/);
  });

  it("is unusable while suspended", () => {
    expect(evaluatePtwValidity({ ...base, status: "suspended" }, NOW).usable).toBe(false);
  });
});

describe("schemas", () => {
  it("rejects an inverted permit window", () => {
    expect(() =>
      permitCreateSchema.parse({
        projectId: UUID,
        permitType: "hot_work",
        location: "Block A",
        description: "Welding of tracker piles",
        validFrom: iso(NOW + HOUR),
        validTo: iso(NOW),
      }),
    ).toThrow();
  });

  it("accepts a valid permit and defaults isolations to empty", () => {
    const p = permitCreateSchema.parse({
      projectId: UUID,
      permitType: "excavation",
      location: "Trench 3",
      description: "Cable trench",
      validFrom: iso(NOW),
      validTo: iso(NOW + HOUR),
    });
    expect(p.isolations).toEqual([]);
  });

  it("requires a non-empty response when answering a TQ", () => {
    expect(() => technicalQueryAnswerSchema.parse({ id: UUID, response: "   " })).toThrow();
    expect(technicalQueryAnswerSchema.parse({ id: UUID, response: "Use M16 bolts" }).response).toBe(
      "Use M16 bolts",
    );
  });

  it("defaults TQ priority to normal and talk status to scheduled", () => {
    expect(
      technicalQuerySchema.parse({ projectId: UUID, subject: "Bolt grade", question: "Which?" })
        .priority,
    ).toBe("normal");
    expect(
      toolboxTalkSchema.parse({ projectId: UUID, talkDate: "2026-07-26", topic: "Heat stress" })
        .status,
    ).toBe("scheduled");
  });

  it("rejects a malformed talk date", () => {
    expect(() =>
      toolboxTalkSchema.parse({ projectId: UUID, talkDate: "26/07/2026", topic: "Heat stress" }),
    ).toThrow();
  });
});
