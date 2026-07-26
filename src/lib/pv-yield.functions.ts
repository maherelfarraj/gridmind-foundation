// P-156 — PV yield simulation server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { canWritePvLayout, httpError } from "@/lib/pv-layout.server";
import {
  approvalDetail,
  auditPvSimulation,
  buildSimulationPrefill,
  latestApprovalStatus,
  loadSimulation,
} from "@/lib/pv-yield.server";
import {
  runYieldV2,
  YIELD_CALC_VERSION,
  YIELD_ENGINE_ID,
  type YieldInput,
} from "@/lib/pv/yield-v2";

const twelve = z.array(z.number().finite()).length(12);

const inputSchema = z.object({
  latitudeDeg: z.number().min(-90).max(90),
  tiltDeg: z.number().min(0).max(90),
  azimuthDeg: z.number().min(-180).max(180),
  albedo: z.number().min(0).max(1).default(0.2),
  tracker: z
    .object({
      type: z.enum(["fixed", "single_axis"]),
      maxAngleDeg: z.number().min(0).max(90).optional(),
    })
    .nullable()
    .default(null),
  gcr: z.number().min(0.05).max(0.95),
  monthlyGhiKwhM2: twelve,
  monthlyAmbientTempC: twelve,
  monthlyDiffuseFraction: twelve.nullable().default(null),
  monthlySoilingPct: twelve,
  arrayDcKwp: z.number().positive(),
  inverterAcKw: z.number().positive(),
  modulePmaxPctPerC: z.number().min(-1).max(0),
  moduleNoctC: z.number().min(20).max(70),
  degradationYear1Pct: z.number().min(0).max(20),
  mismatchPct: z.number().min(0).max(20),
  dcWiringLossPct: z.number().min(0).max(20),
  inverterEffCurve: z
    .array(
      z.object({ loadFraction: z.number().min(0).max(1), effPct: z.number().min(50).max(100) }),
    )
    .min(1)
    .max(32),
  transformerLossPct: z.number().min(0).max(10),
  mvCollectionLossPct: z.number().min(0).max(10),
  gridAvailabilityPct: z.number().min(0).max(100),
  plantAvailabilityPct: z.number().min(0).max(100),
  gridLimitKw: z.number().positive().nullable().default(null),
  auxiliaryLoadKw: z.number().min(0),
  bess: z
    .object({
      roundTripEffPct: z.number().min(50).max(100),
      throughputFraction: z.number().min(0).max(1),
      libraryId: z.string().uuid().nullable().default(null),
    })
    .nullable()
    .default(null),
  interannualVariabilitySigmaPct: z.number().min(0).max(50).nullable().default(null),
  daylightHours: z.number().min(4).max(16).default(12),
  loadShapeFactor: z.number().min(0.1).max(1).default(0.6),
  inputSources: z.record(z.string(), z.string()).default({}),
});

const runSchema = z.object({
  projectId: z.string().uuid(),
  layoutId: z.string().uuid().nullable().default(null),
  siteConfigId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(120),
  input: inputSchema,
});

/** Lists simulations for a project with their latest result summary. */
export const listPvSimulations = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: sims, error } = await context.supabase
      .from("pv_simulations")
      .select("*, pv_simulation_results(*)")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { simulations: sims ?? [] };
  });

/** Runs the transparent engine and persists an immutable simulation record. */
export const runPvSimulation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) httpError(404, "not_found", "Project not found.");

    const computedAt = new Date().toISOString();
    const result = runYieldV2({ ...(data.input as unknown as YieldInput), computedAt });
    const userId = (context as { user?: { id?: string } }).user?.id ?? null;

    const { data: sim, error: simError } = await context.supabase
      .from("pv_simulations")
      .insert({
        company_id: (project as { company_id: string }).company_id,
        project_id: data.projectId,
        layout_id: data.layoutId,
        site_config_id: data.siteConfigId,
        name: data.name,
        status: "complete",
        engine_id: YIELD_ENGINE_ID,
        calc_version: YIELD_CALC_VERSION,
        inputs: data.input as never,
        input_sources: data.input.inputSources as never,
        computed_at: computedAt,
        created_by: userId,
      } as never)
      .select("id, company_id")
      .single();
    if (simError) throw simError;

    const { error: resError } = await context.supabase.from("pv_simulation_results").insert({
      company_id: (sim as { company_id: string }).company_id,
      simulation_id: (sim as { id: string }).id,
      monthly: result.monthly as never,
      annual: { ...result.annual, disclaimer: result.disclaimer } as never,
      loss_chain: result.loss_chain as never,
      p_scenarios: result.p_scenarios as never,
      engine_id: YIELD_ENGINE_ID,
      calc_version: YIELD_CALC_VERSION,
      computed_at: computedAt,
    } as never);
    if (resError) throw resError;

    await auditPvSimulation(context, "pv_simulation.run", (sim as { id: string }).id, {
      project_id: data.projectId,
      annual_kwh: result.annual.energy_kwh,
      engine_id: YIELD_ENGINE_ID,
    });

    return { simulationId: (sim as { id: string }).id, result };
  });

/** Submits a simulation for the pv_simulation_baseline approval chain. */
export const submitPvSimulation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ simulationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");
    const sim = await loadSimulation(context, data.simulationId);
    if (sim.status === "superseded") httpError(409, "simulation_locked", "Simulation superseded.");

    await context.supabase.rpc("ensure_pv_simulation_rule", { p_company_id: sim.company_id });
    const { data: instanceId, error } = await context.supabase.rpc("start_approval_instance", {
      p_rule_key: "pv_simulation_baseline",
      p_entity_type: "pv_simulation",
      p_entity_id: sim.id,
      p_metadata: { project_id: sim.project_id, name: sim.name } as never,
    });
    if (error) throw error;

    const { error: updateError } = await context.supabase
      .from("pv_simulations")
      .update({ approval_instance_id: (instanceId as string) ?? null } as never)
      .eq("id", sim.id);
    if (updateError) throw updateError;

    await auditPvSimulation(context, "pv_simulation.submitted", sim.id, {
      project_id: sim.project_id,
      approval_instance_id: instanceId,
    });

    return { simulationId: sim.id, approvalInstanceId: (instanceId as string) ?? null };
  });

/**
 * Promotes an approved simulation to the project baseline.
 * The database also enforces approval + one baseline per project.
 */
export const setSimulationBaseline = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ simulationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");
    const sim = await loadSimulation(context, data.simulationId);

    const status = await latestApprovalStatus(context, sim.id);
    if (status !== "approved") {
      httpError(
        409,
        "approval_pending",
        "The simulation must be approved before it becomes the project baseline.",
      );
    }

    await context.supabase
      .from("pv_simulations")
      .update({ is_baseline: false, status: "superseded" } as never)
      .eq("project_id", sim.project_id)
      .eq("is_baseline", true);

    const { error } = await context.supabase
      .from("pv_simulations")
      .update({ status: "approved", is_baseline: true } as never)
      .eq("id", sim.id);
    if (error) throw error;

    await auditPvSimulation(context, "pv_simulation.baselined", sim.id, {
      project_id: sim.project_id,
    });

    return { simulationId: sim.id, isBaseline: true };
  });

/** Server-prefilled input sheet: site config + approved layout + P-154 aggregates. */
export const getPvSimulationPrefill = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return buildSimulationPrefill(context, data.projectId);
  });

/** Latest approval instance for a simulation (approver step + SLA age source). */
export const getPvSimulationApproval = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ simulationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return { instance: await approvalDetail(context, data.simulationId) };
  });
