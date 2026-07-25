// P-100 — Commissioning KPI dashboard server functions.
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  KPI_READ_ROLES,
  computeMcCod,
  getCommissioningKpisInput,
  pickPrAtCod,
  rollupPunchClosure,
  type CommissioningKpisPayload,
  type PunchCategory,
  type TestSummaryEntry,
} from "@/lib/commissioning-kpis.rules";

function httpError(status: number, code: string, metadata?: Record<string, unknown>): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code, ...(metadata ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
    metadata,
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

export const getCommissioningKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => getCommissioningKpisInput.parse(raw))
  .handler(async ({ data, context }): Promise<CommissioningKpisPayload> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    const canRead = roles.some((r) => KPI_READ_ROLES.has(r));
    if (!canRead) httpError(403, "forbidden");

    const [
      { data: proj },
      { data: certs },
      { data: yieldCfg },
      { data: perfTests },
      { data: punchRows },
      { data: tests },
      { data: turnover },
    ] = await Promise.all([
      context.supabase
        .from("projects")
        .select("id, name, code, phase, target_cod, company_id")
        .eq("id", data.projectId)
        .maybeSingle(),
      context.supabase
        .from("commissioning_certificates")
        .select("certificate_type, status, effective_date, pr_at_cod")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .in("certificate_type", ["mechanical_completion", "cod"]),
      context.supabase
        .from("project_yield_config")
        .select("contract_pr")
        .eq("project_id", data.projectId)
        .maybeSingle(),
      context.supabase
        .from("performance_tests")
        .select("measured_value, contract_value, period_end, created_at, status, test_type")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .eq("test_type", "performance_ratio")
        .eq("status", "complete")
        .order("period_end", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1),
      context.supabase
        .from("qaqc_punch_items")
        .select("category, status, punch_number")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId),
      context.supabase
        .from("commissioning_tests")
        .select("test_type, status")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId),
      context.supabase
        .from("turnover_packages")
        .select("status, compiled_at, delivered_at")
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .maybeSingle(),
    ]);

    if (!proj || (proj as any).company_id !== companyId) {
      httpError(404, "project_not_found");
    }

    const certList = (certs ?? []) as {
      certificate_type: string;
      status: string;
      effective_date: string | null;
      pr_at_cod: number | null;
    }[];
    const mcCert = certList.find(
      (c) => c.certificate_type === "mechanical_completion" && c.status === "signed",
    );
    const codCert = certList.find((c) => c.certificate_type === "cod" && c.status === "signed");

    const mcCod = computeMcCod({
      mcDate: mcCert?.effective_date ?? null,
      codDate: codCert?.effective_date ?? null,
      targetCod: (proj as any).target_cod ?? null,
    });

    const contractPr = (yieldCfg as any)?.contract_pr ?? null;
    const prAtCod = pickPrAtCod({
      certificate: codCert ? { pr_at_cod: codCert.pr_at_cod } : null,
      latestPerfTest:
        (perfTests?.[0] as { measured_value: number | null; contract_value: number | null }) ??
        null,
      contractPr,
    });

    const punchClosure = rollupPunchClosure(
      (punchRows ?? []) as {
        category: PunchCategory;
        status: string;
        punch_number: string | null;
      }[],
    );

    const testSummary = summarizeTests((tests ?? []) as { test_type: string; status: string }[]);

    const turnoverStatus = turnover
      ? {
          status: (turnover as any).status as string,
          compiled_at: (turnover as any).compiled_at ?? null,
          delivered_at: (turnover as any).delivered_at ?? null,
        }
      : null;

    return {
      project: {
        id: (proj as any).id,
        name: (proj as any).name,
        code: (proj as any).code ?? null,
        phase: (proj as any).phase,
      },
      mcCod,
      prAtCod,
      punchClosure,
      availability: {
        state: "awaiting_scada",
        cod_date: mcCod.cod_date,
      },
      testSummary,
      turnoverStatus,
      permissions: { canRead: true },
    };
  });

function summarizeTests(rows: { test_type: string; status: string }[]): TestSummaryEntry[] {
  const by = new Map<string, TestSummaryEntry>();
  for (const r of rows) {
    const e = by.get(r.test_type) ?? {
      test_type: r.test_type,
      passed: 0,
      failed: 0,
      in_progress: 0,
      not_started: 0,
    };
    if (r.status === "passed") e.passed += 1;
    else if (r.status === "failed") e.failed += 1;
    else if (r.status === "in_progress" || r.status === "scheduled") e.in_progress += 1;
    else e.not_started += 1;
    by.set(r.test_type, e);
  }
  return Array.from(by.values()).sort((a, b) => a.test_type.localeCompare(b.test_type));
}
