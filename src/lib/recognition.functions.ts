// GC-15 — Recognition server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  adjustmentDecisionSchema,
  obligationSchema,
  portfolioRecognitionSchema,
  recognitionAdjustmentSchema,
  recognitionSettingsSchema,
  sensitivitySchema,
  snapshotBuildSchema,
  snapshotCorrectionSchema,
  snapshotTransitionSchema,
} from "@/lib/recognition.rules";
import {
  buildSnapshot,
  correctSnapshot,
  decideAdjustment,
  loadPortfolioRecognition,
  loadRecognitionAppendix,
  loadRecognitionWorkspace,
  resolveRecognitionAccess,
  runSensitivity,
  saveAdjustment,
  saveObligation,
  saveSettings,
  transitionSnapshot,
  type PortfolioRecognitionView,
  type RecognitionAccess,
  type RecognitionAppendix,
  type RecognitionWorkspace,
} from "@/lib/recognition.server";

const workspaceInput = z.object({
  project_id: z.string().uuid(),
  period_month: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
});

export const getRecognitionAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<RecognitionAccess> => {
    requireSupabaseAuth(context);
    return resolveRecognitionAccess(context);
  });

export const getRecognitionWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => workspaceInput.parse(input))
  .handler(async ({ data, context }): Promise<RecognitionWorkspace> => {
    requireSupabaseAuth(context);
    return loadRecognitionWorkspace(context, data.project_id, data.period_month);
  });

export const getRecognitionAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => workspaceInput.parse(input))
  .handler(async ({ data, context }): Promise<RecognitionAppendix> => {
    requireSupabaseAuth(context);
    return loadRecognitionAppendix(context, data.project_id, data.period_month);
  });

export const getPortfolioRecognition = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioRecognitionSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioRecognitionView> => {
    requireSupabaseAuth(context);
    return loadPortfolioRecognition(context, data);
  });

export const saveRecognitionSettings = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => recognitionSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveSettings(context, data);
  });

export const saveRecognitionObligation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => obligationSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveObligation(context, data);
  });

export const buildRecognitionSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => snapshotBuildSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return buildSnapshot(context, data);
  });

export const transitionRecognitionSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => snapshotTransitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return transitionSnapshot(context, data);
  });

export const correctRecognitionSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => snapshotCorrectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return correctSnapshot(context, data);
  });

export const saveRecognitionAdjustment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => recognitionAdjustmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveAdjustment(context, data);
  });

export const decideRecognitionAdjustment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => adjustmentDecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return decideAdjustment(context, data);
  });

export const runRecognitionSensitivity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => sensitivitySchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return runSensitivity(context, data);
  });
