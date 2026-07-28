// P-251/P-252 — Portfolio aggregation server functions.
// Thin wrapper module: imports + createServerFn declarations only.
// All math and tenancy live in the SECURITY DEFINER RPCs, which audit
// ops.portfolio_view and deny external viewers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { consolidateCurve } from "@/lib/portfolio/cash-curve.rules";
import type { CashMovement, ProjectCurveRow } from "@/lib/portfolio/cash-curve.rules";
import {
  countRows,
  periodFromWindow,
  type PortfolioExecReportData,
} from "@/lib/portfolio/exec-report.rules";
import type { PortfolioExposure } from "@/lib/portfolio/exposure.rules";
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

// P-254 — deeper exposure cut: severity split, TRIR trend, hold points.
export const getPortfolioHseExposure = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<PortfolioExposure> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("portfolio_hse_exposure");
    if (error) throw error;
    return data as unknown as PortfolioExposure;
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

// P-253 — Per-project contribution to the consolidated curve.
export const getPortfolioCashCurveProjects = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        back: z.number().int().min(0).max(60).default(12),
        forward: z.number().int().min(0).max(60).default(6),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ProjectCurveRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("portfolio_cash_curve_projects", {
      p_back: data.back,
      p_forward: data.forward,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as ProjectCurveRow[];
  });

// P-253 — Month drill: every cash movement in one month, across projects.
export const getPortfolioCashMonth = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CashMovement[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("portfolio_cash_month", {
      p_month: data.month,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as CashMovement[];
  });

// P-255 — Executive portfolio report data (branding + all four sections).
// Governance: internal finance/company-admin tier only, every project's export
// lock asserted (typed 423), and one export.portfolio_report audit row with
// actor + row counts. Returns a pure DTO so the PDF generator stays headless.
export const getPortfolioExecReportData = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        back: z.number().int().min(0).max(36).default(12),
        forward: z.number().int().min(0).max(36).default(6),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<PortfolioExecReportData> => {
    requireSupabaseAuth(context);
    const supabase = context.supabase;
    const userId = context.user!.id;

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("company_id, full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    const companyId = (profile as { company_id?: string | null } | null)?.company_id;
    if (!companyId) throw Object.assign(new Error("no_company"), { statusCode: 400 });

    // Finance / company-admin tier only.
    const roleChecks = await Promise.all(
      (["company_admin", "finance_admin", "super_admin"] as const).map((role) =>
        supabase.rpc("has_company_role", { p_role: role as never }),
      ),
    );
    if (!roleChecks.some((r) => r.data === true)) {
      throw Object.assign(new Error("forbidden_role"), { statusCode: 403 });
    }

    const [companyRes, brandingRes, kpisRes, cardsRes, gatesRes, curveRes, exposureRes] =
      await Promise.all([
        supabase.from("companies").select("id, name, legal_name").eq("id", companyId).single(),
        supabase
          .from("company_branding")
          .select("primary_color, accent_color, footer_text, logo_url")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase.rpc("portfolio_kpis"),
        supabase.rpc("portfolio_project_cards"),
        supabase.rpc("portfolio_gates"),
        supabase.rpc("portfolio_cash_curve_projects", { p_back: data.back, p_forward: data.forward }),
        supabase.rpc("portfolio_hse_exposure"),
      ]);
    for (const res of [companyRes, kpisRes, cardsRes, gatesRes, curveRes, exposureRes]) {
      if (res.error) throw res.error;
    }

    const branding = (brandingRes.data ?? null) as {
      primary_color: string | null;
      accent_color: string | null;
      footer_text: string | null;
      logo_url: string | null;
    } | null;
    let logoSignedUrl: string | null = null;
    if (branding?.logo_url) {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(branding.logo_url, 300);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    const kpis = kpisRes.data as unknown as PortfolioKpis;
    const cards = (cardsRes.data ?? []) as unknown as PortfolioProjectCard[];
    const gates = (gatesRes.data ?? []) as unknown as PortfolioGateRow[];
    const exposure = exposureRes.data as unknown as PortfolioExposure;
    const curve = consolidateCurve((curveRes.data ?? []) as unknown as ProjectCurveRow[]);

    // Export governance: a lock on ANY project in scope blocks the rollup.
    for (const card of cards) {
      await assertExportAllowed(supabase, card.project_id, "portfolio_report");
    }

    const period = curve.length
      ? { start: curve[0].month, end: curve[curve.length - 1].month }
      : periodFromWindow(new Date(), data.back, data.forward);
    const company = companyRes.data as { id: string; name: string; legal_name: string | null };
    const rowCounts = countRows({ cards, gates, curve, exposure });

    try {
      await supabase.rpc("write_audit_log", {
        p_action: "export.portfolio_report",
        p_entity: "companies",
        p_entity_id: companyId,
        p_metadata: {
          actor_id: userId,
          period_start: period.start,
          period_end: period.end,
          base_currency: kpis?.base_currency ?? "USD",
          row_counts: rowCounts,
        } as never,
      });
    } catch {
      /* audit is advisory — never block a governed export that already passed */
    }

    return {
      company: { id: company.id, name: company.name, legalName: company.legal_name },
      branding: {
        primaryColor: branding?.primary_color ?? null,
        accentColor: branding?.accent_color ?? null,
        footerText: branding?.footer_text ?? null,
        logoSignedUrl,
      },
      period,
      generatedAt: new Date().toISOString(),
      generatedBy:
        (profile as { full_name?: string | null; email?: string | null } | null)?.full_name ??
        (profile as { email?: string | null } | null)?.email ??
        "Unknown user",
      baseCurrency: kpis?.base_currency ?? "USD",
      kpis,
      cards,
      gates,
      curve,
      exposure,
      rowCounts,
    };
  });
