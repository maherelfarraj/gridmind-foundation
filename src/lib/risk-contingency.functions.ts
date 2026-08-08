// GC-17 — Risk & contingency server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  loadPortfolioRiskAppendix,
  loadRiskContingencyAppendix,
  type RiskContingencyAppendix,
} from "@/lib/risk-appendix.server";
import {
  createSimRun,
  decideAlert,
  decideSimRun,
  loadPortfolioRiskContingency,
  loadRiskContingencyWorkspace,
  resolveRcAccess,
  type PortfolioRiskSummary,
  type RiskContingencyAccess,
  type RiskContingencyWorkspace,
  type SimRunRow,
} from "@/lib/risk-contingency.server";
import { ALERT_STATUSES, SIM_STATUSES, simRequestSchema } from "@/lib/risk-sim.rules";

const projectInput = z.object({ project_id: z.string().uuid() });

const simDecisionSchema = z.object({
  id: z.string().uuid(),
  target: z.enum(SIM_STATUSES),
  row_version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});

const alertDecisionSchema = z.object({
  id: z.string().uuid(),
  target: z.enum(ALERT_STATUSES),
  row_version: z.number().int().min(1),
  snoozed_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const getRiskContingencyAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<RiskContingencyAccess> => {
    requireSupabaseAuth(context);
    return resolveRcAccess(context);
  });

export const getRiskContingencyWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }): Promise<RiskContingencyWorkspace> => {
    requireSupabaseAuth(context);
    return loadRiskContingencyWorkspace(context, data.project_id);
  });

export const getPortfolioRiskContingency = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioRiskSummary> => {
    requireSupabaseAuth(context);
    return loadPortfolioRiskContingency(context);
  });

export const getRiskContingencyAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }): Promise<RiskContingencyAppendix> => {
    requireSupabaseAuth(context);
    return loadRiskContingencyAppendix(context, data.project_id);
  });

export const getPortfolioRiskAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioRiskSummary> => {
    requireSupabaseAuth(context);
    return loadPortfolioRiskAppendix(context);
  });

export const runRiskSimulation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => simRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<SimRunRow> => {
    requireSupabaseAuth(context);
    return createSimRun(context, data);
  });

export const decideRiskSimulation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => simDecisionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await decideSimRun(context, data);
    return { ok: true };
  });

export const decideRiskAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => alertDecisionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await decideAlert(context, data);
    return { ok: true };
  });
