// P-219 — IO helpers for the ESG report approval + PDF flow. Server-only.
import type { Client } from "@/lib/cwp.server";
import { httpError } from "@/lib/cwp.server";
import {
  buildReportTotals,
  computeAvoided,
  computeEmissions,
  DEFAULT_GRID_FACTOR_KG_PER_KWH,
  ESG_METHODOLOGY_NOTE,
  resolveFactor,
  type ComputedRow,
} from "@/lib/esg/carbon";
import {
  loadCarbonFactors,
  loadPeriodActivities,
  sumMeteredEnergyKwh,
  type EsgReportRow,
} from "@/lib/esg/carbon.server";
import { carbonIntensity, diversionRate, kwhToMwh } from "@/lib/esg/dashboard.rules";
import { loadTrir, loadWasteSummary } from "@/lib/esg/dashboard.server";
import {
  ESG_REPORT_ENTITY,
  ESG_REPORT_RULE_KEY,
  esgReportPdfPath,
  lenderIndicatorRows,
  scopeTableRows,
  type LenderIndicatorRow,
  type ScopeTableRow,
} from "@/lib/esg/report.rules";

export type EsgReportRecord = EsgReportRow & {
  report_number: string | null;
  approval_instance_id: string | null;
  pdf_path: string | null;
  rejection_comment: string | null;
};

export async function loadReport(
  client: Client,
  companyId: string,
  reportId: string,
): Promise<EsgReportRecord> {
  const { data, error } = await client
    .from("esg_reports")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "report_not_found", "ESG report not found");
  return data as never;
}

export async function patchReport(
  client: Client,
  reportId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from("esg_reports")
    .update(patch as never)
    .eq("id", reportId);
  if (error) throw error;
}

export interface EsgApprovalSnapshot {
  id: string;
  status: string;
  current_step: number;
  sla_due_at: string | null;
}

export async function loadEsgApproval(
  client: Client,
  reportId: string,
): Promise<EsgApprovalSnapshot | null> {
  const { data, error } = await client
    .from("approval_instances")
    .select("id, status, current_step, sla_due_at, requested_at")
    .eq("entity_type", ESG_REPORT_ENTITY)
    .eq("entity_id", reportId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as
    | { id: string; status: string; current_step: number | null; sla_due_at: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step ?? 1,
    sla_due_at: row.sla_due_at,
  };
}

/** Opens the hse_admin → company_admin chain. Returns null when unconfigured. */
export async function startEsgApproval(
  client: Client,
  report: { id: string; report_number: string | null; project_id: string },
  period: { from: string; to: string },
): Promise<string | null> {
  const { data, error } = await client.rpc("start_approval_instance", {
    p_rule_key: ESG_REPORT_RULE_KEY,
    p_entity_type: ESG_REPORT_ENTITY,
    p_entity_id: report.id,
    p_amount: null as never,
    p_metadata: {
      report_number: report.report_number,
      project_id: report.project_id,
      period: `${period.from}..${period.to}`,
    } as never,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function loadDecisionComment(
  client: Client,
  instanceId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("approvals")
    .select("comment, decided_at")
    .eq("instance_id", instanceId)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as { comment: string | null } | undefined)?.comment ?? null;
}

export interface EsgBrandingBundle {
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    footerText: string | null;
    logoSignedUrl: string | null;
  };
  company: { name: string; legalName: string | null };
  project: { id: string; name: string; code: string | null };
}

export async function loadBrandingBundle(
  client: Client,
  companyId: string,
  projectId: string,
): Promise<EsgBrandingBundle> {
  const [companyRes, brandingRes, projectRes] = await Promise.all([
    client.from("companies").select("name, legal_name").eq("id", companyId).maybeSingle(),
    client
      .from("company_branding")
      .select("logo_url, primary_color, accent_color, footer_text")
      .eq("company_id", companyId)
      .maybeSingle(),
    client.from("projects").select("id, name, code").eq("id", projectId).maybeSingle(),
  ]);

  const brand = (brandingRes.data ?? {}) as Record<string, string | null>;
  let logoSignedUrl: string | null = null;
  if (brand.logo_url) {
    const { data: signed } = await client.storage
      .from("documents")
      .createSignedUrl(brand.logo_url, 900);
    logoSignedUrl = signed?.signedUrl ?? null;
  }
  const project = (projectRes.data ?? {}) as Record<string, string | null>;

  return {
    branding: {
      primaryColor: brand.primary_color ?? null,
      accentColor: brand.accent_color ?? null,
      footerText: brand.footer_text ?? null,
      logoSignedUrl,
    },
    company: {
      name: (companyRes.data as { name?: string } | null)?.name ?? "Company",
      legalName: (companyRes.data as { legal_name?: string | null } | null)?.legal_name ?? null,
    },
    project: {
      id: projectId,
      name: project.name ?? "Project",
      code: project.code ?? null,
    },
  };
}

export interface EsgReportPackage extends EsgBrandingBundle {
  report: {
    id: string;
    report_number: string | null;
    period_from: string;
    period_to: string;
    status: string;
    pdf_path: string;
  };
  scopes: Array<{ scope: string; title: string; rows: ScopeTableRow[]; subtotal_kg: number }>;
  summary: {
    scope_1_kg: number;
    scope_2_kg: number;
    scope_3_kg: number;
    avoided_kg: number | null;
    net_kg: number;
  };
  avoided: {
    metered_mwh: number | null;
    grid_factor_kg_per_kwh: number;
    grid_factor_code: string;
    grid_factor_source: string;
    avoided_kg: number | null;
    note: string | null;
  };
  lender_indicators: LenderIndicatorRow[];
  methodology_note: string;
}

const SCOPE_TITLES: Record<string, string> = {
  scope_1: "Scope 1 — direct emissions",
  scope_2: "Scope 2 — purchased energy",
  scope_3: "Scope 3 — value chain",
};

/** Full render payload: recomputes rows for the stored period. */
export async function buildReportPackage(
  client: Client,
  companyId: string,
  report: EsgReportRow & { report_number: string | null },
): Promise<EsgReportPackage> {
  const { period_from: from, period_to: to, project_id: projectId } = report;

  const [bundle, factors, activities, meteredKwh, waste, hse] = await Promise.all([
    loadBrandingBundle(client, companyId, projectId),
    loadCarbonFactors(client, companyId),
    loadPeriodActivities(client, projectId, from, to),
    sumMeteredEnergyKwh(client, projectId, from, to),
    loadWasteSummary(client, companyId, projectId, from, to),
    loadTrir(client, companyId, projectId, from, to),
  ]);

  const emissions = computeEmissions(activities, factors);
  const gridFactor = resolveFactor("electricity_grid", from, factors);
  const gridPerKwh = gridFactor?.kg_co2e_per_unit ?? DEFAULT_GRID_FACTOR_KG_PER_KWH;
  const avoidedKg = meteredKwh === null ? null : computeAvoided(meteredKwh, gridPerKwh).avoided_kg;
  const totals = buildReportTotals({
    totals: emissions.totals,
    avoidedKg,
    unfactoredCount: emissions.unfactored.length,
  });

  const rows: readonly ComputedRow[] = emissions.rows;
  const scopes = ["scope_1", "scope_2", "scope_3"].map((scope) => {
    const scopeRows = scopeTableRows(rows, scope);
    return {
      scope,
      title: SCOPE_TITLES[scope],
      rows: scopeRows,
      subtotal_kg: scopeRows.reduce((s, r) => s + r.co2e_kg, 0),
    };
  });

  const meteredMwh = kwhToMwh(meteredKwh);
  const diversion = waste.available
    ? diversionRate(waste.recyclable_kg, waste.total_kg)
    : { pct: null };

  return {
    ...bundle,
    report: {
      id: report.id,
      report_number: report.report_number,
      period_from: from,
      period_to: to,
      status: report.status,
      pdf_path: esgReportPdfPath(companyId, report.id),
    },
    scopes,
    summary: {
      scope_1_kg: totals.scope_1_kg,
      scope_2_kg: totals.scope_2_kg,
      scope_3_kg: totals.scope_3_kg,
      avoided_kg: totals.avoided_kg,
      net_kg: totals.net_kg,
    },
    avoided: {
      metered_mwh: meteredMwh,
      grid_factor_kg_per_kwh: gridPerKwh,
      grid_factor_code: gridFactor?.factor_code ?? "JO-GRID-DEFAULT",
      grid_factor_source: gridFactor?.factor_source ?? "Jordan default",
      avoided_kg: avoidedKg,
      note:
        avoidedKg === null
          ? "No metered generation telemetry for this period — avoided emissions not claimed."
          : null,
    },
    lender_indicators: lenderIndicatorRows({
      totals: emissions.totals,
      avoidedKg,
      netKg: totals.net_kg,
      meteredMwh,
      intensity: carbonIntensity(emissions.totals, meteredKwh),
      diversionPct: diversion.pct,
      trir: hse.available ? hse.trir : null,
    }),
    methodology_note: ESG_METHODOLOGY_NOTE,
  };
}

export async function upsertReportDocument(
  client: Client,
  args: {
    companyId: string;
    projectId: string;
    reportId: string;
    reportNumber: string | null;
    path: string;
    userId: string;
    period: { from: string; to: string };
  },
): Promise<void> {
  const title = `ESG report ${args.reportNumber ?? args.reportId.slice(0, 8)} (${args.period.from} – ${args.period.to})`;
  const { data: existing } = await client
    .from("documents")
    .select("id")
    .eq("company_id", args.companyId)
    .eq("storage_path", args.path)
    .maybeSingle();

  const payload = {
    company_id: args.companyId,
    project_id: args.projectId,
    category: "report",
    title,
    file_name: args.path.split("/").pop() ?? "esg-report.pdf",
    mime_type: "application/pdf",
    storage_path: args.path,
    tags: ["esg", "esg_report"],
    metadata: {
      entity: "esg_report",
      report_id: args.reportId,
      report_number: args.reportNumber,
      period_from: args.period.from,
      period_to: args.period.to,
    },
    created_by: args.userId,
  };

  const { error } = existing
    ? await client
        .from("documents")
        .update(payload as never)
        .eq("id", (existing as { id: string }).id)
    : await client.from("documents").insert(payload as never);
  if (error) throw error;
}
