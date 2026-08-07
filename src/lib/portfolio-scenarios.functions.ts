// GC-11 — Portfolio scenario server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assumptionDeleteSchema,
  assumptionSaveSchema,
  scenarioCreateSchema,
  scenarioDuplicateSchema,
  scenarioIdSchema,
  scenarioLifecycleSchema,
  scenarioListSchema,
  scenarioUpdateSchema,
  scenarioViewSchema,
  type Scenario,
  type ScenarioAssumption,
} from "@/lib/portfolio-scenarios.rules";
import {
  createScenario,
  deleteAssumption,
  deleteScenario,
  duplicateScenario,
  exportScenarioCsv,
  listScenarios,
  loadScenario,
  saveAssumption,
  transitionScenario,
  updateScenario,
  type ScenarioResultPayload,
} from "@/lib/portfolio-scenarios.server";

export type { ScenarioResultPayload };

export const getPortfolioScenarios = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioListSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<Scenario[]> => {
    requireSupabaseAuth(context);
    return listScenarios(context, data);
  });

export const getPortfolioScenario = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioViewSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScenarioResultPayload> => {
    requireSupabaseAuth(context);
    return loadScenario(context, data.id, data.compare_to);
  });

export const createPortfolioScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<Scenario> => {
    requireSupabaseAuth(context);
    return createScenario(context, data);
  });

export const updatePortfolioScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<Scenario> => {
    requireSupabaseAuth(context);
    return updateScenario(context, data);
  });

export const transitionPortfolioScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioLifecycleSchema.parse(input))
  .handler(async ({ data, context }): Promise<Scenario> => {
    requireSupabaseAuth(context);
    return transitionScenario(context, data.id, data.action);
  });

export const duplicatePortfolioScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioDuplicateSchema.parse(input))
  .handler(async ({ data, context }): Promise<Scenario> => {
    requireSupabaseAuth(context);
    return duplicateScenario(context, data.id, data.name);
  });

export const deletePortfolioScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return deleteScenario(context, data.id);
  });

export const savePortfolioScenarioAssumption = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => assumptionSaveSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScenarioAssumption> => {
    requireSupabaseAuth(context);
    return saveAssumption(context, data);
  });

export const deletePortfolioScenarioAssumption = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => assumptionDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return deleteAssumption(context, data.id, data.scenario_id);
  });

export const getPortfolioScenarioCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scenarioIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    return exportScenarioCsv(context, data.id);
  });
