// P-169 — Server-only helpers for the engineering study report.
// Kept out of *.functions.ts so server-fn splitting cannot drop them.
import { assertExportAllowed } from "@/lib/export-guard";
import { eaError, EA_STUDY_COLUMNS, EA_TABLE, type EaStudyRow } from "@/lib/ea-studies.server";
import { EA_DISCLAIMER, EA_STUDY_SPECS } from "@/lib/ea/study-types";
import { createExportTheme } from "@/lib/exports/theme";
import type { EaReportApprovalStep, EaReportPayload } from "@/lib/exports/ea-study-report-pdf";

export const EA_REPORT_BUCKET = "documents";

/** Typed 423 when the project carries an active export lock. */
export async function assertEaReportAllowed(context: any, projectId: string): Promise<void> {
  try {
    await assertExportAllowed(context.supabase, projectId, "ea_study_report");
  } catch (err) {
    if ((err as { code?: string }).code === "export_locked") {
      eaError(423, "export_locked", "Export blocked: this project has an active lock.");
    }
    throw err;
  }
}

export async function loadStudyForReport(context: any, studyId: string): Promise<EaStudyRow> {
  const { data, error } = await context.supabase
    .from(EA_TABLE)
    .select(EA_STUDY_COLUMNS)
    .eq("id", studyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) eaError(404, "study_not_found", "Study not found.");
  return data as unknown as EaStudyRow;
}

async function loadApprovalSteps(
  context: any,
  instanceId: string | null,
): Promise<EaReportApprovalStep[]> {
  if (!instanceId) return [];
  const { data, error } = await context.supabase
    .from("approvals")
    .select("step_order, status, decided_at, comment, approver_id")
    .eq("instance_id", instanceId)
    .order("step_order", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = [...new Set(rows.map((r) => r.approver_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) names.set(p.id, p.full_name);
    }
  }
  return rows.map((r) => ({
    step_order: Number(r.step_order ?? 0),
    role: null,
    approver: names.get(String(r.approver_id ?? "")) ?? null,
    status: String(r.status ?? "pending"),
    decided_at: (r.decided_at as string | null) ?? null,
    comment: (r.comment as string | null) ?? null,
  }));
}

/** Everything the PDF builder needs, plus the branded theme. */
export async function buildReportContext(context: any, study: EaStudyRow) {
  const [{ data: project }, { data: company }, { data: branding }, approvalSteps] =
    await Promise.all([
      context.supabase
        .from("projects")
        .select("name, project_code")
        .eq("id", study.project_id)
        .maybeSingle(),
      context.supabase
        .from("companies")
        .select("name, legal_name")
        .eq("id", study.company_id)
        .maybeSingle(),
      context.supabase
        .from("company_branding")
        .select("logo_url, primary_color, accent_color, footer_text")
        .eq("company_id", study.company_id)
        .maybeSingle(),
      loadApprovalSteps(context, study.approval_instance_id),
    ]);

  const theme = await createExportTheme(
    {
      primaryColor: (branding as any)?.primary_color ?? null,
      accentColor: (branding as any)?.accent_color ?? null,
      footerText: (branding as any)?.footer_text ?? null,
      logoSignedUrl: (branding as any)?.logo_url ?? null,
    },
    {
      name: (company as any)?.name ?? null,
      legal_name: (company as any)?.legal_name ?? null,
    },
  );

  const payload: EaReportPayload = {
    studyNumber: study.study_number,
    title: study.title,
    studyTypeLabel: EA_STUDY_SPECS[study.study_type]?.label ?? study.study_type,
    status: study.status,
    revision: study.revision,
    projectName: ((project as any)?.name ?? "Project") as string,
    projectCode: ((project as any)?.project_code ?? null) as string | null,
    standardsRef: study.standards_ref ?? [],
    method: study.method ?? "",
    inputSheet: study.input_sheet,
    results: study.results,
    warnings: study.warnings,
    assumptions: study.assumptions,
    submittedAt: study.submitted_at,
    approvedAt: study.approved_at,
    approvalSteps,
    disclaimer: EA_DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };

  return { payload, theme };
}

/** Uploads the PDF and registers the documents row. */
export async function storeReport(
  context: any,
  study: EaStudyRow,
  bytes: Uint8Array,
): Promise<{ storagePath: string; documentId: string | null; fileName: string }> {
  const fileName = `${study.study_number}-rev-${study.revision}.pdf`;
  const storagePath = `ea/${study.company_id}/${study.id}/rev-${study.revision}.pdf`;

  const { error: upErr } = await context.supabase.storage
    .from(EA_REPORT_BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw upErr;

  const { data: existing } = await context.supabase
    .from("documents")
    .select("id")
    .eq("project_id", study.project_id)
    .eq("storage_path", storagePath)
    .maybeSingle();

  const row = {
    company_id: study.company_id,
    project_id: study.project_id,
    title: `${study.study_number} — ${study.title} (rev ${study.revision})`,
    category: "report" as const,
    storage_path: storagePath,
    file_name: fileName,
    file_size_bytes: bytes.byteLength,
    mime_type: "application/pdf",
    tags: ["electrical-analysis", "ea-study"],
    metadata: {
      study_id: study.id,
      study_number: study.study_number,
      study_type: study.study_type,
      revision: study.revision,
    },
  };

  if (existing) {
    const { error } = await context.supabase
      .from("documents")
      .update(row as never)
      .eq("id", (existing as { id: string }).id);
    if (error) throw error;
    return { storagePath, documentId: (existing as { id: string }).id, fileName };
  }

  const { data: inserted, error } = await context.supabase
    .from("documents")
    .insert({ ...row, created_by: context.user.id } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { storagePath, documentId: (inserted as { id: string }).id, fileName };
}

/** Short-lived download link for the freshly written report. */
export async function signReport(context: any, storagePath: string): Promise<string | null> {
  const { data } = await context.supabase.storage
    .from(EA_REPORT_BUCKET)
    .createSignedUrl(storagePath, 900);
  return ((data as any)?.signedUrl ?? null) as string | null;
}
