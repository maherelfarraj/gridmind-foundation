// GC-10 — Portfolio finance alerts server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { alertConfigUpdateSchema, alertFilterSchema } from "@/lib/portfolio-alerts.rules";
import {
  acknowledgeAlert,
  evaluateNow,
  loadAlertsCsv,
  loadPortfolioAlerts,
  snoozeAlert,
  updateAlertConfig,
  type EvaluationResult,
  type PortfolioAlertsData,
} from "@/lib/portfolio-alerts.server";

export type { PortfolioAlertsData };

export const getPortfolioAlerts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => alertFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioAlertsData> => {
    requireSupabaseAuth(context);
    return loadPortfolioAlerts(context, data);
  });

export const getPortfolioAlertsCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => alertFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    return loadAlertsCsv(context, data);
  });

export const acknowledgePortfolioAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ alert_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return acknowledgeAlert(context, data.alert_id);
  });

export const snoozePortfolioAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ alert_id: z.string().uuid(), until: z.string().min(4) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return snoozeAlert(context, data.alert_id, data.until);
  });

export const savePortfolioAlertConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => alertConfigUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return updateAlertConfig(context, data);
  });

export const evaluatePortfolioAlertsNow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period: z
          .string()
          .regex(/^\d{4}-\d{2}-01$/)
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<EvaluationResult> => {
    requireSupabaseAuth(context);
    return evaluateNow(context, data.period);
  });

export const getPortfolioAlertAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period: z.string().regex(/^\d{4}-\d{2}-01$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { loadAlertAppendix } = await import("@/lib/portfolio-alerts.server");
    return loadAlertAppendix(context, data.period);
  });
