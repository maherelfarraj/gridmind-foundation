// P-251/P-252 — Portfolio aggregation server functions.
// Thin wrapper module: imports + createServerFn declarations only.
// All math and tenancy live in the SECURITY DEFINER RPCs, which audit
// ops.portfolio_view and deny external viewers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { EvmAggregate } from "@/lib/portfolio/portfolio.rules";

export interface PortfolioKpis {
  base_currency: string;
  projects: {
    total: number;
    by_phase: Record<string, number>;
    by_status: Record<string, number>;
  };
  contract_value: number;
  evm: EvmAggregate;
  ar_open: number;
  ap_open: number;
  cash_mtd: { inflow: number; outflow: number };
}

export interface PortfolioGateRow {
  project_id: string;
  project_code: string;
  project_name: string;
  phase: string;
  status: string;
  gates_total: number;
  gates_approved: number;
  current_gate_name: string | null;
  current_gate_status: string | null;
  next_gate_name: string | null;
  next_gate_due: string | null;
}

export interface PortfolioProjectCard extends PortfolioGateRow {
  target_cod: string | null;
  contract_value: number;
  currency_code: string;
  planned_value: number;
  earned_value: number;
  actual_cost: number;
  spi: number | null;
  cpi: number | null;
  punch_a_open: number;
}

export interface PortfolioHseQuality {
  incidents_open: number;
  incidents_total: number;
  recordable_count: number;
  exposure_hours: number;
  trir: number | null;
  punch_open: Record<string, number>;
  punch_open_total: number;
  ncr_open: number;
  by_project: Array<{
    project_id: string;
    project_code: string;
    project_name: string;
    incidents_open: number;
    punch_open: number;
    ncr_open: number;
  }>;
}

export interface PortfolioCashCurveRow {
  month: string;
  base_currency: string;
  forecast_inflow: number;
  forecast_outflow: number;
  actual_inflow: number;
  actual_outflow: number;
  forecast_net: number;
  actual_net: number;
}

export const getPortfolioKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioKpis> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("portfolio_kpis");
    if (error) throw error;
    return data as unknown as PortfolioKpis;
  });

export const getPortfolioGates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioGateRow[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("portfolio_gates");
    if (error) throw error;
    return (data ?? []) as unknown as PortfolioGateRow[];
  });

export const getPortfolioProjectCards = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioProjectCard[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("portfolio_project_cards");
    if (error) throw error;
    return (data ?? []) as unknown as PortfolioProjectCard[];
  });

export const getPortfolioHseQuality = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioHseQuality> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("portfolio_hse_quality");
    if (error) throw error;
    return data as unknown as PortfolioHseQuality;
  });

export const getPortfolioCashCurve = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ months: z.number().int().min(1).max(36).default(12) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PortfolioCashCurveRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("portfolio_cash_curve", {
      p_months: data.months,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as PortfolioCashCurveRow[];
  });
