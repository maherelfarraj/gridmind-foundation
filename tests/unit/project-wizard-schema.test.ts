import { describe, expect, it } from "vitest";

import {
  makeProjectBasicsSchema,
  suggestProjectCode,
  PROJECT_CODE_REGEX,
} from "@/lib/schemas/project-wizard";

const futureDate = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const pastDate = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

const base = {
  name: "Prairie Winds Solar",
  code: "PWS-2026",
  capacity_mw: 120,
  target_cod: futureDate(),
};

describe("makeProjectBasicsSchema", () => {
  it("requires MWh for standalone_bess", () => {
    const schema = makeProjectBasicsSchema("standalone_bess");
    const res = schema.safeParse(base);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.path.join(".") === "capacity_mwh"),
      ).toBe(true);
    }
    expect(schema.safeParse({ ...base, capacity_mwh: 240 }).success).toBe(true);
  });

  it("requires MWh for hybrid_pv_bess", () => {
    const schema = makeProjectBasicsSchema("hybrid_pv_bess");
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, capacity_mwh: 60 }).success).toBe(true);
  });

  it("does not require MWh for utility_pv", () => {
    const schema = makeProjectBasicsSchema("utility_pv");
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("rejects past target_cod", () => {
    const schema = makeProjectBasicsSchema("utility_pv");
    const res = schema.safeParse({ ...base, target_cod: pastDate() });
    expect(res.success).toBe(false);
  });

  it("enforces project code regex", () => {
    const schema = makeProjectBasicsSchema("utility_pv");
    expect(schema.safeParse({ ...base, code: "ab" }).success).toBe(false);
    expect(schema.safeParse({ ...base, code: "TOOLONGCODE12" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, code: "PV-01" }).success).toBe(true);
  });
});

describe("suggestProjectCode", () => {
  it("uses initials plus year", () => {
    expect(suggestProjectCode("Prairie Winds Solar", 2026)).toBe("PWS-2026");
  });

  it("falls back when name yields nothing", () => {
    expect(suggestProjectCode("   ", 2026)).toBe("PRJ-2026");
  });

  it("caps at three initials and matches the regex", () => {
    const code = suggestProjectCode("Alpha Beta Gamma Delta", 2030);
    expect(code).toBe("ABG-2030");
    expect(PROJECT_CODE_REGEX.test(code)).toBe(true);
  });
});
