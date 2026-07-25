// P-095 — Performance ratio test server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  attachPrReportInput,
  computePerformanceRatio,
  createPrTestInput,
} from "@/lib/performance-tests.schema";

// ---- shared helpers (private) --------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

const WRITE_ROLES = new Set([
  "construction_admin",
  "company_admin",
  "project_admin",
  "engineer",
]);
function canWrite(roles: string[]): boolean {
  return roles.some((r) => WRITE_ROLES.has(r));
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

// ---- DTOs -----------------------------------------------------------------
export interface PrTestRow {
  id: string;
  project_id: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  metered_energy_mwh: number | null;
  plane_of_array_kwh_m2: number | null;
  contract_value: number | null; // contract PR %
  measured_value: number | null; // measured PR %
  capacity_mwp: number | null;
  variance_pct: number | null;
  notes: string | null;
  report_file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrTestListResult {
  rows: PrTestRow[];
  canWrite: boolean;
}

export interface PrTestDefaults {
  capacityMwp: number | null;
  contractPr: number | null;
  projectName: string | null;
  projectCode: string | null;
  companyName: string | null;
  companyLegalName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  logoPath: string | null;
  logoSignedUrl: string | null;
}

function toRow(r: any, capacityMwp: number | null): PrTestRow {
  const contract = r.contract_value != null ? Number(r.contract_value) : null;
  const measured = r.measured_value != null ? Number(r.measured_value) : null;
  const variance =
    contract != null && measured != null && contract > 0
      ? ((measured - contract) / contract) * 100
      : null;
  return {
    id: r.id,
    project_id: r.project_id,
    status: r.status,
    period_start: r.period_start,
    period_end: r.period_end,
    metered_energy_mwh:
      r.metered_energy_mwh != null ? Number(r.metered_energy_mwh) : null,
    plane_of_array_kwh_m2:
      r.plane_of_array_kwh_m2 != null
        ? Number(r.plane_of_array_kwh_m2)
        : null,
    contract_value: contract,
    measured_value: measured,
    capacity_mwp: capacityMwp,
    variance_pct: variance,
    notes: r.notes ?? null,
    report_file_path: r.report_file_path ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---- defaults -------------------------------------------------------------
const projectInput = z.object({ projectId: z.string().uuid() });

export const getPerformanceTestDefaults = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => projectInput.parse(raw))
  .handler(async ({ data, context }): Promise<PrTestDefaults> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, name, code, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(404, "project_not_found");

    const [{ data: pv }, { data: yc }, { data: co }, { data: br }] =
      await Promise.all([
        context.supabase
          .from("project_pv_config")
          .select("dc_capacity_mwp")
          .eq("project_id", data.projectId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        context.supabase
          .from("project_yield_config")
          .select("contract_pr, updated_at")
          .eq("project_id", data.projectId)
          .not("contract_pr", "is", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        context.supabase
          .from("companies")
          .select("name, legal_name")
          .eq("id", companyId)
          .maybeSingle(),
        context.supabase
          .from("company_branding")
          .select("primary_color, accent_color, logo_url")
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);

    return {
      capacityMwp:
        (pv as any)?.dc_capacity_mwp != null
          ? Number((pv as any).dc_capacity_mwp)
          : null,
      contractPr:
        (yc as any)?.contract_pr != null
          ? Number((yc as any).contract_pr)
          : null,
      projectName: (proj as any).name ?? null,
      projectCode: (proj as any).code ?? null,
      companyName: (co as any)?.name ?? null,
      companyLegalName: (co as any)?.legal_name ?? null,
      primaryColor: (br as any)?.primary_color ?? null,
      accentColor: (br as any)?.accent_color ?? null,
      logoPath: (br as any)?.logo_url ?? null,
    };
  });

// ---- list -----------------------------------------------------------------
export const listPerformanceTests = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => projectInput.parse(raw))
  .handler(async ({ data, context }): Promise<PrTestListResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);

    const { data: rows, error } = await context.supabase
      .from("performance_tests")
      .select(
        "id, project_id, company_id, status, period_start, period_end, metered_energy_mwh, plane_of_array_kwh_m2, contract_value, measured_value, notes, report_file_path, created_at, updated_at",
      )
      .eq("project_id", data.projectId)
      .eq("company_id", companyId)
      .eq("test_type", "performance_ratio")
      .order("period_end", { ascending: false });
    if (error) throw error;

    const { data: pv } = await context.supabase
      .from("project_pv_config")
      .select("dc_capacity_mwp")
      .eq("project_id", data.projectId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const capacity =
      (pv as any)?.dc_capacity_mwp != null
        ? Number((pv as any).dc_capacity_mwp)
        : null;

    return {
      rows: ((rows ?? []) as any[]).map((r) => toRow(r, capacity)),
      canWrite: canWrite(roles),
    };
  });

// ---- create (completed) ---------------------------------------------------
export const createPerformanceRatioTest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => createPrTestInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; pr: number }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWrite(roles)) httpError(403, "forbidden");

    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(404, "project_not_found");

    const pr = computePerformanceRatio(
      data.meteredEnergyMwh,
      data.poaKwhPerM2,
      data.capacityMwp,
    );
    if (pr == null) httpError(400, "invalid_inputs");

    const results = {
      capacity_mwp: data.capacityMwp,
      pr_pct: pr,
      contract_pr_pct: data.contractPr,
      variance_pct: ((pr! - data.contractPr) / data.contractPr) * 100,
      computed_at: new Date().toISOString(),
    };

    const { data: ins, error: iErr } = await context.supabase
      .from("performance_tests")
      .insert({
        company_id: companyId,
        project_id: data.projectId,
        test_type: "performance_ratio",
        status: "completed",
        unit: "%",
        period_start: data.periodStart,
        period_end: data.periodEnd,
        metered_energy_mwh: data.meteredEnergyMwh,
        plane_of_array_kwh_m2: data.poaKwhPerM2,
        contract_value: data.contractPr,
        measured_value: pr,
        results: results as any,
        notes: data.notes ?? null,
        created_by: context.user!.id,
      } as any)
      .select("id")
      .single();
    if (iErr) throw iErr;

    const id = (ins as any).id as string;
    await audit(context, "performance.pr_test_created", "performance_tests", id, {
      pr_pct: pr,
      contract_pr_pct: data.contractPr,
    });
    return { id, pr: pr! };
  });

// ---- attach report --------------------------------------------------------
export const attachPerformanceReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attachPrReportInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWrite(roles)) httpError(403, "forbidden");

    const { data: row, error } = await context.supabase
      .from("performance_tests")
      .select("id, company_id, project_id")
      .eq("id", data.testId)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).company_id !== companyId)
      httpError(404, "test_not_found");
    const r = row as any;

    const expectedPrefix = `${companyId}/pr-report/${r.project_id}/${data.testId}/`;
    if (!data.storagePath.startsWith(expectedPrefix)) {
      httpError(400, "invalid_report_path");
    }

    const { error: upErr } = await context.supabase
      .from("performance_tests")
      .update({ report_file_path: data.storagePath } as any)
      .eq("id", data.testId);
    if (upErr) throw upErr;

    await context.supabase.from("documents").insert({
      company_id: companyId,
      project_id: r.project_id,
      title: data.fileName,
      category: "report",
      storage_path: data.storagePath,
      file_name: data.fileName,
      file_size_bytes: data.fileSizeBytes,
      mime_type: "application/pdf",
      tags: ["pr_test", "performance_ratio"],
      created_by: context.user!.id,
      metadata: { performance_test_id: data.testId } as any,
    } as any);

    await audit(
      context,
      "performance.pr_report_attached",
      "performance_tests",
      data.testId,
      { path: data.storagePath },
    );
    return { id: data.testId };
  });
