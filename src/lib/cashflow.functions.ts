// GC-13 — Governed cash flow, funding and liquidity server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  cashScenarioSchema,
  cashflowAdjustmentDecisionSchema,
  cashflowAdjustmentSchema,
  cashflowCalculateSchema,
  cashflowCsvSchema,
  cashflowIdSchema,
  cashflowQuerySchema,
  cashflowSettingsSchema,
  cashflowSupersedeSchema,
  cashflowTransitionSchema,
  fundingAllocationSchema,
  fundingFacilitySchema,
  portfolioCashFilterSchema,
  type CashflowStatus,
} from "@/lib/cashflow.rules";
import {
  decideCashflowAdjustment,
  deleteFundingAllocation,
  listCashflowAdjustments,
  listFundingFacilities,
  loadCashflowAppendix,
  loadCashflowCsv,
  loadCashflowSettings,
  loadCashflowWorkspace,
  loadPortfolioCashflow,
  loadPortfolioCashflowAppendix,
  runCashScenario,
  saveCashflowAdjustment,
  saveCashflowSettings,
  saveCashflowSnapshot,
  saveFundingAllocation,
  saveFundingFacility,
  supersedeCashflowSnapshot,
  transitionCashflowSnapshot,
  type AdjustmentRow,
  type CashScenarioResult,
  type CashflowAppendix,
  type CashflowSettings,
  type CashflowWorkspaceData,
  type FacilityRow,
  type PortfolioCashData,
} from "@/lib/cashflow.server";

export type {
  AdjustmentRow,
  CashScenarioResult,
  CashflowAppendix,
  CashflowSettings,
  CashflowWorkspaceData,
  FacilityRow,
  PortfolioCashData,
};

export const getCashflowWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<CashflowWorkspaceData> => {
    requireSupabaseAuth(context);
    return loadCashflowWorkspace(context, data);
  });

export const getCashflowSettings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowQuerySchema.pick({ project_id: true }).parse(input))
  .handler(async ({ data, context }): Promise<CashflowSettings> => {
    requireSupabaseAuth(context);
    return loadCashflowSettings(context, data.project_id);
  });

export const saveCashflowSettingsFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<CashflowSettings> => {
    requireSupabaseAuth(context);
    return saveCashflowSettings(context, data);
  });

export const calculateCashflowSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowCalculateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ snapshot_id: string }> => {
    requireSupabaseAuth(context);
    return saveCashflowSnapshot(context, data);
  });

export const transitionCashflowSnapshotFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowTransitionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: CashflowStatus }> => {
    requireSupabaseAuth(context);
    return transitionCashflowSnapshot(context, data);
  });

export const supersedeCashflowSnapshotFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowSupersedeSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ snapshot_id: string }> => {
    requireSupabaseAuth(context);
    return supersedeCashflowSnapshot(context, data);
  });

export const getCashflowAdjustments = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowQuerySchema.pick({ project_id: true }).parse(input))
  .handler(async ({ data, context }): Promise<AdjustmentRow[]> => {
    requireSupabaseAuth(context);
    return listCashflowAdjustments(context, data.project_id);
  });

export const saveCashflowAdjustmentFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowAdjustmentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return saveCashflowAdjustment(context, data);
  });

export const decideCashflowAdjustmentFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowAdjustmentDecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return decideCashflowAdjustment(context, data);
  });

export const getFundingFacilities = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<FacilityRow[]> => {
    requireSupabaseAuth(context);
    return listFundingFacilities(context);
  });

export const saveFundingFacilityFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => fundingFacilitySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return saveFundingFacility(context, data);
  });

export const saveFundingAllocationFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => fundingAllocationSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return saveFundingAllocation(context, data);
  });

export const deleteFundingAllocationFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await deleteFundingAllocation(context, data.id);
    return { ok: true };
  });

export const runCashScenarioFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashScenarioSchema.parse(input))
  .handler(async ({ data, context }): Promise<CashScenarioResult> => {
    requireSupabaseAuth(context);
    return runCashScenario(context, data);
  });

export const getCashflowCsv = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowCsvSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    return loadCashflowCsv(context, data);
  });

export const getCashflowAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => cashflowQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<CashflowAppendix> => {
    requireSupabaseAuth(context);
    return loadCashflowAppendix(context, data);
  });

export const getPortfolioCashflow = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioCashFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioCashData> => {
    requireSupabaseAuth(context);
    return loadPortfolioCashflow(context, data);
  });

export const getPortfolioCashflowAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioCashFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioCashData> => {
    requireSupabaseAuth(context);
    return loadPortfolioCashflowAppendix(context, data);
  });
