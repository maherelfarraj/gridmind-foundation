// P-056 — Yield scenarios: server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// Constants + schemas
// ---------------------------------------------------------------------------
export const TRACKING_TYPES = [
  "fixed",
  "1p_tracker",
  "2p_tracker",
] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

export const LOSS_KEYS = [
  "soiling",
  "temperature",
  "mismatch",
  "wiring",
  "inverter",
  "availability",
] as const;
export type LossKey = (typeof LOSS_KEYS)[number];

const WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;

export const YIELD_STUB_VERSION = "gridmind-yield-stub-v1";

export interface YieldParams {
  tilt_deg: number;
  azimuth_deg: number;
  gcr: number;
  tracking: TrackingType;
  bifacial: boolean;
  dc_ac_ratio: number;
  losses_pct: Record<LossKey, number>;
}

export interface YieldResults {
  p50_mwh?: number | null;
  p90_mwh?: number | null;
  specific_yield_kwh_kwp?: number | null;
  pr_pct?: number | null;
  losses_pct?: number | null;
  imported?: boolean;
  source_document_id?: string | null;
  stub_version?: string | null;
  computed_at?: string | null;
}

export interface YieldScenarioRow {
  id: string;
  project_id: string;
  company_id: string;
  scenario_name: string;
  params: Record<string, any>;
  results: YieldResults;
  updated_at: string;
  capacity_mw: number | null;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProject(
  context: any,
  projectId: string,
): Promise<{ id: string; company_id: string; capacity_mw: number | null }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, capacity_mw")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as any;
}

async function assertRole(
  context: any,
  companyId: string,
  roles: readonly string[],
) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", roles as any)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) httpError(403, "forbidden");
}

async function audit(
  context: any,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    /* never break the write */
  }
}

// ---------------------------------------------------------------------------
// Deterministic estimate (stub)
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function estimateFromParams(
  params: YieldParams,
  capacityMw: number,
  seedKey: string,
): YieldResults {
  const mwp = capacityMw > 0 ? capacityMw : 100;
  const rand = mulberry32(hashString(seedKey));

  // Baseline specific yield (kWh/kWp/yr) tuned by tracking type.
  const baseline =
    params.tracking === "2p_tracker"
      ? 1800
      : params.tracking === "1p_tracker"
        ? 1720
        : 1600;

  // Tilt penalty: peak at 25°, quadratic falloff.
  const tiltDelta = Math.max(0, Math.min(90, params.tilt_deg)) - 25;
  const tiltFactor = 1 - Math.min(0.12, (tiltDelta * tiltDelta) / 20000);

  // GCR shading penalty above 0.35.
  const gcrPenalty = Math.max(0, params.gcr - 0.35) * 0.25;
  const gcrFactor = 1 - gcrPenalty;

  // Bifacial gain.
  const bifacialFactor = params.bifacial ? 1.06 : 1.0;

  // Losses total (%): each loss subtracts directly.
  const lossTotal = LOSS_KEYS.reduce(
    (acc, k) => acc + Number(params.losses_pct?.[k] ?? 0),
    0,
  );
  const lossFactor = Math.max(0.4, 1 - lossTotal / 100);

  // Small deterministic wobble ±0.5%.
  const wobble = 1 + (rand() - 0.5) * 0.01;

  const specific =
    baseline * tiltFactor * gcrFactor * bifacialFactor * lossFactor * wobble;

  const p50_mwh = Math.round((specific * mwp * 1) / 1) / 1; // kWh/kWp × MWp = MWh
  const p90_mwh = Math.round(p50_mwh * 0.92 * 100) / 100;
  const pr_pct = Math.max(0, 100 - lossTotal);

  return {
    p50_mwh: Math.round(p50_mwh * 100) / 100,
    p90_mwh,
    specific_yield_kwh_kwp: Math.round(specific * 10) / 10,
    pr_pct: Math.round(pr_pct * 10) / 10,
    losses_pct: Math.round(lossTotal * 10) / 10,
    imported: false,
    stub_version: YIELD_STUB_VERSION,
    computed_at: new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const lossesSchema = z.object({
  soiling: z.number().min(0).max(40),
  temperature: z.number().min(0).max(40),
  mismatch: z.number().min(0).max(40),
  wiring: z.number().min(0).max(40),
  inverter: z.number().min(0).max(40),
  availability: z.number().min(0).max(40),
});

const paramsSchema = z.object({
  tilt_deg: z.number().min(0).max(90),
  azimuth_deg: z.number().min(0).max(360),
  gcr: z.number().min(0.1).max(0.9),
  tracking: z.enum(TRACKING_TYPES),
  bifacial: z.boolean(),
  dc_ac_ratio: z.number().min(0.8).max(1.6),
  losses_pct: lossesSchema,
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({ projectId: z.string().uuid() });

export const listYieldScenarios = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<YieldScenarioRow[]> => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);

    const { data: rows, error } = await context.supabase
      .from("project_yield_config")
      .select(
        "id, project_id, company_id, scenario_name, params, results, updated_at",
      )
      .eq("project_id", project.id)
      .order("scenario_name", { ascending: true });
    if (error) throw error;

    return (rows ?? []).map((r: any) => ({
      id: r.id,
      project_id: r.project_id,
      company_id: r.company_id,
      scenario_name: r.scenario_name,
      params: (r.params ?? {}) as any,
      results: (r.results ?? {}) as YieldResults,
      updated_at: r.updated_at,
      capacity_mw: project.capacity_mw != null ? Number(project.capacity_mw) : null,
    }));
  });

// ---------------------------------------------------------------------------
// save (create/update by scenario name)
// ---------------------------------------------------------------------------
const saveInput = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid().optional(),
  scenarioName: z.string().trim().min(1).max(60),
  params: paramsSchema,
});

export const saveYieldScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    // Load prior for diff.
    const { data: prior } = await context.supabase
      .from("project_yield_config")
      .select("id, scenario_name, params")
      .eq("project_id", project.id)
      .eq("scenario_name", data.scenarioName)
      .maybeSingle();

    const payload: any = {
      company_id: project.company_id,
      project_id: project.id,
      scenario_name: data.scenarioName,
      params: data.params,
    };
    if (prior?.id) payload.id = prior.id;

    const { data: saved, error } = await context.supabase
      .from("project_yield_config")
      .upsert(payload, { onConflict: "project_id,scenario_name" })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    const changed: string[] = [];
    if (!prior) {
      changed.push("created");
    } else {
      if (
        JSON.stringify((prior as any).params ?? {}) !==
        JSON.stringify(data.params)
      ) {
        changed.push("params");
      }
    }

    await audit(
      context,
      "engineering.yield_scenario_saved",
      "project_yield_config",
      (saved?.id ?? prior?.id ?? project.id) as string,
      {
        project_id: project.id,
        scenario_name: data.scenarioName,
        changed_fields: changed,
      },
    );

    return { ok: true, id: saved?.id ?? prior?.id, changed_fields: changed };
  });

// ---------------------------------------------------------------------------
// estimate (deterministic stub)
// ---------------------------------------------------------------------------
const estimateInput = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
});

export const estimateYieldScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => estimateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const { data: row, error } = await context.supabase
      .from("project_yield_config")
      .select("id, scenario_name, params")
      .eq("project_id", project.id)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "scenario_not_found");

    const params = (row.params ?? {}) as unknown as YieldParams;
    if (!params.losses_pct) {
      httpError(400, "scenario_missing_params", "Save scenario params first");
    }

    const capacity = project.capacity_mw != null ? Number(project.capacity_mw) : 0;
    const results = estimateFromParams(
      params,
      capacity,
      `${project.id}:${row.scenario_name}`,
    );

    const { error: uErr } = await context.supabase
      .from("project_yield_config")
      .update({ results: results as any })
      .eq("id", row.id);
    if (uErr) throw uErr;

    await audit(
      context,
      "engineering.yield_scenario_saved",
      "project_yield_config",
      row.id,
      {
        project_id: project.id,
        scenario_name: row.scenario_name,
        action: "estimate",
        stub_version: YIELD_STUB_VERSION,
      },
    );

    return { ok: true, results };
  });

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------
const duplicateInput = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
  newName: z.string().trim().min(1).max(60),
});

export const duplicateYieldScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => duplicateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const { data: source, error } = await context.supabase
      .from("project_yield_config")
      .select("params, results")
      .eq("project_id", project.id)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!source) httpError(404, "scenario_not_found");

    const { data: created, error: iErr } = await context.supabase
      .from("project_yield_config")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        scenario_name: data.newName,
        params: source.params as any,
        results: {} as any,
      })
      .select("id")
      .maybeSingle();
    if (iErr) {
      if ((iErr as any).code === "23505") {
        httpError(409, "scenario_name_exists");
      }
      throw iErr;
    }

    await audit(
      context,
      "engineering.yield_scenario_saved",
      "project_yield_config",
      (created?.id ?? project.id) as string,
      {
        project_id: project.id,
        scenario_name: data.newName,
        action: "duplicate",
        source_id: data.id,
      },
    );

    return { ok: true, id: created?.id };
  });

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
const deleteInput = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
});

export const deleteYieldScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const { data: row, error } = await context.supabase
      .from("project_yield_config")
      .select("id, scenario_name")
      .eq("project_id", project.id)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "scenario_not_found");
    if (row.scenario_name === "Proposal") {
      httpError(
        409,
        "proposal_scenario_locked",
        "The Proposal scenario is managed by the proposal flow.",
      );
    }

    const { error: dErr } = await context.supabase
      .from("project_yield_config")
      .delete()
      .eq("id", data.id);
    if (dErr) throw dErr;

    await audit(
      context,
      "engineering.yield_scenario_saved",
      "project_yield_config",
      data.id,
      {
        project_id: project.id,
        scenario_name: row.scenario_name,
        action: "delete",
      },
    );

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// PVsyst import (metrics-only; file already stored via site-data flow)
// ---------------------------------------------------------------------------
const importInput = z.object({
  projectId: z.string().uuid(),
  scenarioName: z.string().trim().min(1).max(60),
  documentId: z.string().uuid().optional(),
  metrics: z.object({
    p50_mwh: z.number().min(0),
    p90_mwh: z.number().min(0),
    pr_pct: z.number().min(0).max(100),
    specific_yield_kwh_kwp: z.number().min(0).max(4000),
  }),
});

export const importPvsystScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const results: YieldResults = {
      p50_mwh: data.metrics.p50_mwh,
      p90_mwh: data.metrics.p90_mwh,
      pr_pct: data.metrics.pr_pct,
      specific_yield_kwh_kwp: data.metrics.specific_yield_kwh_kwp,
      imported: true,
      source_document_id: data.documentId ?? null,
      computed_at: new Date().toISOString(),
    };

    const { data: saved, error } = await context.supabase
      .from("project_yield_config")
      .upsert(
        {
          company_id: project.company_id,
          project_id: project.id,
          scenario_name: data.scenarioName,
          params: { imported_from: "pvsyst" } as any,
          results: results as any,
        },
        { onConflict: "project_id,scenario_name" },
      )
      .select("id")
      .maybeSingle();
    if (error) throw error;

    await audit(
      context,
      "engineering.yield_scenario_saved",
      "project_yield_config",
      (saved?.id ?? project.id) as string,
      {
        project_id: project.id,
        scenario_name: data.scenarioName,
        action: "pvsyst_import",
        document_id: data.documentId ?? null,
      },
    );

    return { ok: true, id: saved?.id };
  });

// ---------------------------------------------------------------------------
// role probe
// ---------------------------------------------------------------------------
const rolesInput = z.object({ projectId: z.string().uuid() });

export const getMyYieldRoles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => rolesInput.parse(input))
  .handler(async ({ data, context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("company_id", project.company_id)
      .in("role", WRITE_ROLES as any)
      .limit(1);
    if (error) throw error;
    return { canWrite: (rows?.length ?? 0) > 0 };
  });

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------
const kpiInput = z.object({ projectId: z.string().uuid() });

export const getEngineeringYieldKpi = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => kpiInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      scenarioCount: number;
      latestP50Mwh: number | null;
      baseP50Mwh: number | null;
    }> => {
      requireSupabaseAuth(context);
      const project = await loadProject(context, data.projectId);
      const { data: rows, error } = await context.supabase
        .from("project_yield_config")
        .select("scenario_name, results, updated_at")
        .eq("project_id", project.id);
      if (error) throw error;
      const list = (rows ?? []) as Array<any>;
      const sortedByUpdated = [...list].sort((a, b) =>
        (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
      );
      const latest = sortedByUpdated[0];
      const base = list.find((r) => r.scenario_name === "Base");
      return {
        scenarioCount: list.length,
        latestP50Mwh: latest?.results?.p50_mwh ?? null,
        baseP50Mwh: base?.results?.p50_mwh ?? null,
      };
    },
  );
