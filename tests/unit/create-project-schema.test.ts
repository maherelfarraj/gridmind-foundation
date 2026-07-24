import { describe, expect, it } from "vitest";
import { makeCreateProjectSchema } from "@/lib/schemas/project-wizard";

const base = {
  companyId: "11111111-1111-1111-1111-111111111111",
  template_id: null,
  name: "Prairie Winds",
  code: "PW-2026",
  capacity_mw: 150,
  target_cod: new Date(Date.now() + 86_400_000 * 365),
  project_admin_id: "22222222-2222-2222-2222-222222222222",
  member_ids: [],
  dept_leads: {},
};

describe("makeCreateProjectSchema", () => {
  it("accepts a minimal utility_pv payload", () => {
    const schema = makeCreateProjectSchema("utility_pv");
    expect(schema.safeParse({ ...base, archetype: "utility_pv" }).success).toBe(true);
  });

  it("requires MWh for BESS archetypes", () => {
    const schema = makeCreateProjectSchema("standalone_bess");
    const bad = schema.safeParse({ ...base, archetype: "standalone_bess" });
    expect(bad.success).toBe(false);
    const good = schema.safeParse({
      ...base,
      archetype: "standalone_bess",
      capacity_mwh: 400,
    });
    expect(good.success).toBe(true);
  });

  it("rejects a past target COD", () => {
    const schema = makeCreateProjectSchema("utility_pv");
    const r = schema.safeParse({
      ...base,
      archetype: "utility_pv",
      target_cod: new Date(Date.now() - 86_400_000),
    });
    expect(r.success).toBe(false);
  });
});
