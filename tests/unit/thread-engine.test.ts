// P-192 — emitThreadEvent fan-out for all five documented event types.
// Supabase is mocked at the query/rpc boundary (P-130..P-133 harness style).
import { describe, expect, it } from "vitest";

import { emitThreadEvent } from "@/lib/digital-thread/engine.server";
import { IMPACT_MAP, impactAreas, THREAD_EVENTS } from "@/lib/digital-thread/impact-map";

const PROJECT = {
  id: "11111111-1111-1111-1111-111111111111",
  company_id: "c1",
  name: "East Amman 50 MW",
};

type Rows = Record<string, unknown[]>;

function makeDb(
  rows: Rows,
  rpcResults: Record<string, unknown> = {},
  opts: { throwOn?: string } = {},
) {
  const calls = {
    rpc: [] as Array<{ name: string; args: any }>,
    inserts: [] as Array<{ table: string; payload: any }>,
  };
  const builder = (table: string) => {
    if (opts.throwOn === table) throw new Error(`boom:${table}`);
    const state = { rows: rows[table] ?? [] };
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      ilike: () => api,
      contains: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: state.rows[0] ?? null, error: null }),
      single: async () => ({ data: state.rows[0] ?? null, error: null }),
      insert: (payload: any) => {
        calls.inserts.push({ table, payload });
        return { ...api, error: null, data: payload };
      },
      then: (resolve: any) => resolve({ data: state.rows, error: null }),
    };
    return api;
  };
  let assessmentCounter = 0;
  const db = {
    from: builder,
    rpc: async (name: string, args: any) => {
      calls.rpc.push({ name, args });
      if (name === "create_impact_assessment" && rpcResults[name] === "AUTO") {
        // The guarded RPC is idempotent per open (event, source): same id twice.
        assessmentCounter += 1;
        return { data: "assessment-stable-id", error: null };
      }
      const v = rpcResults[name];
      return { data: v ?? null, error: v ? null : { message: "no" } };
    },
    get assessmentCalls() {
      return assessmentCounter;
    },
  };
  return { db, calls };
}

function areasOf(res: { impacts: Array<{ area: string }> }) {
  return res.impacts.map((i) => i.area);
}

const baseRows: Rows = {
  projects: [PROJECT],
  user_roles: [{ user_id: "u1" }, { user_id: "u2" }],
};

describe("emitThreadEvent — blueprint §8 fan-out", () => {
  it("module_changed fans out to stringing, quantities, yield, procurement and approved vendor", async () => {
    const { db } = makeDb(
      {
        ...baseRows,
        pv_layouts: [{ id: "l1" }],
        bom_snapshots: [{ id: "b1" }],
        pv_simulations: [{ id: "s1" }],
        rfqs: [{ id: "r1" }],
      },
      { create_impact_assessment: "a1", link_entities: "ok" },
    );
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "module_changed",
        sourceType: "project",
        sourceId: PROJECT.id,
        projectId: PROJECT.id,
      },
    );
    expect(areasOf(res)).toEqual([
      "stringing",
      "quantities",
      "energy_yield",
      "procurement",
      "approved_vendor",
    ]);
    expect(areasOf(res)).toEqual(impactAreas("module_changed"));
  });

  it("inverter_changed fans out to sld, layout, dc_ac, transformer loading, cable schedules, procurement and simulation", async () => {
    const { db } = makeDb(
      { ...baseRows, sld_drawings: [{ id: "sld1" }], pv_layouts: [{ id: "l1" }] },
      { create_impact_assessment: "a2", link_entities: "ok" },
    );
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "inverter_changed",
        sourceType: "project",
        sourceId: PROJECT.id,
        projectId: PROJECT.id,
      },
    );
    expect(areasOf(res)).toEqual([
      "sld",
      "layout",
      "dc_ac_ratio",
      "transformer_loading",
      "cable_schedules",
      "procurement_package",
      "simulation",
    ]);
    expect(IMPACT_MAP.inverter_changed.severity).toBe("high");
  });

  it("redline_marked derives the as-built drawing revision", async () => {
    const { db, calls } = makeDb(
      { ...baseRows, drawing_register: [{ id: "d1" }] },
      { create_impact_assessment: "a3", link_entities: "ok" },
    );
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "redline_marked",
        sourceType: "drawing",
        sourceId: "d1",
        projectId: PROJECT.id,
        payload: { drawingId: "d1" },
      },
    );
    expect(areasOf(res)).toEqual(["as_built"]);
    expect(IMPACT_MAP.redline_marked.impacts[0].link_type).toBe("derives");
    const link = calls.rpc.find((c) => c.name === "link_entities");
    expect(link).toBeTruthy();
  });

  it("asbuilt_approved targets the equipment registry", async () => {
    const { db } = makeDb({ ...baseRows }, { create_impact_assessment: "a4", link_entities: "ok" });
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "asbuilt_approved",
        sourceType: "drawing",
        sourceId: "d1",
        projectId: PROJECT.id,
        payload: { equipmentId: "eq1" },
      },
    );
    expect(areasOf(res)).toEqual(["equipment_registry"]);
    expect(res.impacts[0].entity_type).toBe("equipment");
    expect(res.impacts[0].entity_id).toBe("eq1");
  });

  it("scada_alarm_raised resolves equipment, drawing, warranty, work order, spare part and contractor", async () => {
    const { db } = makeDb(
      {
        ...baseRows,
        scada_assets: [{ equipment_id: "eq9" }],
        equipment_registry: [{ tag: "INV-01" }],
        drawing_register: [{ id: "dw1" }],
        warranty_contracts: [{ id: "wc1" }],
        warranty_claims: [{ id: "wcl1" }],
        work_orders: [{ id: "wo1" }],
        spare_parts: [{ id: "sp1", preferred_vendor_id: "v1" }],
      },
      { create_impact_assessment: "a5", link_entities: "ok" },
    );
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "scada_alarm_raised",
        sourceType: "scada_alarm",
        sourceId: "al1",
        projectId: PROJECT.id,
        payload: { scadaAssetId: "sa1" },
      },
    );
    expect(areasOf(res)).toEqual([
      "equipment",
      "drawing",
      "warranty",
      "work_order",
      "spare_parts",
      "responsible_contractor",
    ]);
    expect(res.impacts.every((i) => i.entity_id !== null)).toBe(true);
  });

  it("covers exactly the five documented event types", () => {
    expect([...THREAD_EVENTS]).toEqual([
      "module_changed",
      "inverter_changed",
      "redline_marked",
      "asbuilt_approved",
      "scada_alarm_raised",
    ]);
  });
});

describe("emitThreadEvent — invariants", () => {
  it("is idempotent: a second emit returns the same assessment id", async () => {
    const { db } = makeDb(baseRows, { create_impact_assessment: "AUTO", link_entities: "ok" });
    const input = {
      event: "module_changed" as const,
      sourceType: "project",
      sourceId: PROJECT.id,
      projectId: PROJECT.id,
    };
    const first = await emitThreadEvent({ supabase: db as never }, input);
    const second = await emitThreadEvent({ supabase: db as never }, input);
    expect(first.assessmentId).toBe("assessment-stable-id");
    expect(second.assessmentId).toBe(first.assessmentId);
  });

  it("records unresolved targets in the impacts payload with a null id", async () => {
    const { db, calls } = makeDb(baseRows, { create_impact_assessment: "a6" });
    const res = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "module_changed",
        sourceType: "project",
        sourceId: PROJECT.id,
        projectId: PROJECT.id,
      },
    );
    expect(res.impacts).toHaveLength(5);
    expect(res.impacts.every((i) => i.entity_id === null)).toBe(true);
    const rpc = calls.rpc.find((c) => c.name === "create_impact_assessment")!;
    expect(rpc.args.p_impacts).toHaveLength(5);
    expect(rpc.args.p_impacts.every((i: any) => "entity_id" in i)).toBe(true);
  });

  it("skips cleanly on an unknown event and a missing project", async () => {
    const { db } = makeDb(baseRows, { create_impact_assessment: "a7" });
    const unknown = await emitThreadEvent(
      { supabase: db as never },
      {
        event: "not_an_event" as never,
        sourceType: "project",
        sourceId: PROJECT.id,
        projectId: PROJECT.id,
      },
    );
    expect(unknown.skipped).toBe("unknown_event");

    const { db: empty } = makeDb({});
    const missing = await emitThreadEvent(
      { supabase: empty as never },
      {
        event: "module_changed",
        sourceType: "project",
        sourceId: PROJECT.id,
        projectId: PROJECT.id,
      },
    );
    expect(missing.skipped).toBe("project_not_found");
  });

  it("never throws into the caller when the database misbehaves", async () => {
    const { db } = makeDb(baseRows, {}, { throwOn: "impact_assessments" });
    await expect(
      emitThreadEvent(
        { supabase: db as never },
        {
          event: "module_changed",
          sourceType: "project",
          sourceId: PROJECT.id,
          projectId: PROJECT.id,
        },
      ),
    ).resolves.toMatchObject({ assessmentId: null });
  });
});
