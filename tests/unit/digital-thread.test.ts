import { describe, expect, it } from "vitest";

import { emitThreadEvent } from "@/lib/digital-thread/engine.server";
import { IMPACT_MAP, impactAreas, THREAD_EVENTS } from "@/lib/digital-thread/impact-map";

describe("IMPACT_MAP", () => {
  it("covers the five blueprint change events", () => {
    expect(THREAD_EVENTS).toHaveLength(5);
    for (const e of THREAD_EVENTS) expect(IMPACT_MAP[e].impacts.length).toBeGreaterThan(0);
  });

  it("fans a module change out to stringing, quantities, yield and procurement", () => {
    expect(impactAreas("module_changed")).toEqual(
      expect.arrayContaining(["stringing", "quantities", "energy_yield", "procurement"]),
    );
  });

  it("treats an inverter change as high severity across seven areas", () => {
    expect(IMPACT_MAP.inverter_changed.severity).toBe("high");
    expect(impactAreas("inverter_changed")).toHaveLength(7);
  });

  it("uses a derives link for red-line → as-built", () => {
    expect(IMPACT_MAP.redline_marked.impacts[0].link_type).toBe("derives");
  });
});

/** Minimal chainable Supabase stub: records calls, returns scripted rows. */
function makeDb(rows: Record<string, unknown[]>, rpcResults: Record<string, unknown> = {}) {
  const calls: { rpc: Array<{ name: string; args: any }>; inserts: Array<{ table: string; payload: any }> } = {
    rpc: [],
    inserts: [],
  };
  const builder = (table: string) => {
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
        return { ...api, then: undefined, error: null, data: payload };
      },
      upsert: (payload: any) => {
        calls.inserts.push({ table, payload });
        return api;
      },
      then: (resolve: any) => resolve({ data: state.rows, error: null }),
    };
    return api;
  };
  const db = {
    from: builder,
    rpc: async (name: string, args: any) => {
      calls.rpc.push({ name, args });
      return { data: rpcResults[name] ?? null, error: rpcResults[name] ? null : { message: "no" } };
    },
  };
  return { db, calls };
}

describe("emitThreadEvent", () => {
  const project = { id: "11111111-1111-1111-1111-111111111111", company_id: "c1", name: "East Amman" };

  it("skips cleanly when the project cannot be resolved", async () => {
    const { db } = makeDb({});
    const res = await emitThreadEvent({ supabase: db as never }, {
      event: "module_changed",
      sourceType: "project",
      sourceId: project.id,
      projectId: project.id,
    });
    expect(res.skipped).toBe("project_not_found");
    expect(res.assessmentId).toBeNull();
  });

  it("writes one assessment carrying every mapped area and links resolved targets", async () => {
    const { db, calls } = makeDb(
      {
        projects: [project],
        pv_layouts: [{ id: "22222222-2222-2222-2222-222222222222" }],
        bom_snapshots: [{ id: "33333333-3333-3333-3333-333333333333" }],
        pv_simulations: [{ id: "44444444-4444-4444-4444-444444444444" }],
        rfqs: [{ id: "55555555-5555-5555-5555-555555555555" }],
        user_roles: [{ user_id: "u1" }, { user_id: "u1" }],
      },
      { create_impact_assessment: "aaaa", link_entities: "link" },
    );

    const res = await emitThreadEvent({ supabase: db as never }, {
      event: "module_changed",
      sourceType: "project",
      sourceId: project.id,
      projectId: project.id,
    });

    expect(res.assessmentId).toBe("aaaa");
    expect(res.impacts.map((i) => i.area)).toEqual(impactAreas("module_changed"));
    // Vendor is unresolvable without a payload hint — recorded, but not linked.
    expect(res.impacts.find((i) => i.area === "approved_vendor")?.entity_id).toBeNull();
    const links = calls.rpc.filter((c) => c.name === "link_entities");
    expect(links).toHaveLength(4);
    expect(res.notified).toBe(1);
  });

  it("never throws when a downstream lookup table is missing", async () => {
    const db = {
      from: () => {
        throw new Error("relation does not exist");
      },
      rpc: async () => ({ data: null, error: { message: "nope" } }),
    };
    await expect(
      emitThreadEvent({ supabase: db as never }, {
        event: "scada_alarm_raised",
        sourceType: "scada_alarm",
        sourceId: "66666666-6666-6666-6666-666666666666",
        projectId: project.id,
      }),
    ).resolves.toMatchObject({ skipped: "project_not_found" });
  });
});
