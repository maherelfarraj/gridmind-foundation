// P-219 — ESG report approval + PDF server functions. Thin wrapper module.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, audit, currentCompanyId, httpError } from "@/lib/cwp.server";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  buildReportPackage,
  loadDecisionComment,
  loadEsgApproval,
  loadReport,
  patchReport,
  startEsgApproval,
  upsertReportDocument,
  type EsgReportPackage,
} from "@/lib/esg/report.server";
import {
  ESG_GENERATE_ROLES,
  ESG_PUBLISH_ROLES,
  ESG_REPORT_EXPORT_TYPE,
  ESG_RULE_MISSING_MESSAGE,
  esgReportPdfPath,
} from "@/lib/esg/report.rules";

const reportIdSchema = z.object({ report_id: z.string().uuid() });
const attachSchema = z.object({ report_id: z.string().uuid(), pdf_path: z.string().min(1) });

/** Step 1 — gate the export, then open the hse_admin → company_admin chain. */
export const generateEsgReportPdf = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reportIdSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_GENERATE_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);

    await assertExportAllowed(context.supabase, report.project_id, ESG_REPORT_EXPORT_TYPE);

    if (report.status !== "draft") {
      httpError(409, "report_not_draft", `Report is already ${report.status}`);
    }

    const open = await loadEsgApproval(context.supabase, report.id);
    if (open && open.status === "pending") {
      return {
        status: "pending_approval" as const,
        approval_instance_id: open.id,
        current_step: open.current_step,
      };
    }

    const instanceId = await startEsgApproval(context.supabase, report, {
      from: report.period_from,
      to: report.period_to,
    });
    if (!instanceId) {
      httpError(409, "esg_approval_rule_missing", ESG_RULE_MISSING_MESSAGE);
    }

    await patchReport(context.supabase, report.id, {
      approval_instance_id: instanceId,
      submitted_at: new Date().toISOString(),
      submitted_by: context.user.id,
      rejection_comment: null,
    });
    await audit(context.supabase, "esg.report_submitted", "esg_reports", report.id, {
      report_id: report.id,
      approval_instance_id: instanceId,
    });

    const snapshot = await loadEsgApproval(context.supabase, report.id);
    return {
      status: "pending_approval" as const,
      approval_instance_id: instanceId as string,
      current_step: snapshot?.current_step ?? 1,
    };
  });

export interface EsgApprovalResult {
  status: string;
  approval_instance_id: string | null;
  approval_status: string | null;
  current_step: number | null;
  comment?: string | null;
  /** Present once the report has been approved — render + upload payload. */
  package?: EsgReportPackage | null;
}

/** Step 2 — reconcile with the approval engine; on approval return the PDF payload. */
export const checkEsgReportApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reportIdSchema.parse(raw))
  .handler(async ({ context, data }): Promise<EsgApprovalResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);
    const snapshot = await loadEsgApproval(context.supabase, report.id);

    if (!snapshot) {
      return {
        status: report.status,
        approval_instance_id: null,
        approval_status: null,
        current_step: null,
        package: null,
      };
    }

    let status: string = report.status;
    let comment: string | null = null;

    // P-248 — the approval engine owns the status write; read it back here.
    if (
      report.status === "draft" &&
      (snapshot.status === "approved" || snapshot.status === "rejected")
    ) {
      await settleEntityForInstance(context.supabase, snapshot.id);
      const settled = await loadReport(context.supabase, companyId, report.id);
      status = settled.status;
      comment =
        snapshot.status === "rejected"
          ? (settled.rejection_comment ??
            (await loadDecisionComment(context.supabase, snapshot.id)))
          : null;
    }

    const pkg =
      status === "approved" || status === "published"
        ? await buildReportPackage(context.supabase, companyId, { ...report, status } as never)
        : null;

    return {
      status,
      approval_instance_id: snapshot.id,
      approval_status: snapshot.status,
      current_step: snapshot.current_step,
      comment,
      package: pkg,
    };
  });

/** Step 3 — record the uploaded PDF + a documents row. */
export const attachEsgReportPdf = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attachSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_GENERATE_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);
    const expected = esgReportPdfPath(companyId, report.id);
    if (data.pdf_path !== expected) {
      httpError(400, "bad_pdf_path", "PDF must be stored at {company_id}/esg/{report_id}.pdf");
    }
    if (report.status === "draft") {
      httpError(409, "report_not_approved", "Only approved reports can store a PDF");
    }

    await patchReport(context.supabase, report.id, { pdf_path: expected });
    await upsertReportDocument(context.supabase, {
      companyId,
      projectId: report.project_id,
      reportId: report.id,
      reportNumber: report.report_number,
      path: expected,
      userId: context.user.id,
      period: { from: report.period_from, to: report.period_to },
    });
    await audit(context.supabase, "esg.report_pdf_stored", "esg_reports", report.id, {
      report_id: report.id,
      pdf_path: expected,
    });
    return { pdf_path: expected };
  });

/** Step 4 — company_admin flips approved → published. */
export const publishEsgReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reportIdSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_PUBLISH_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);
    if (report.status !== "approved") {
      httpError(
        409,
        "report_not_approved",
        `Report is ${report.status} — publish requires approved`,
      );
    }
    await patchReport(context.supabase, report.id, {
      status: "published",
      published_at: new Date().toISOString(),
      published_by: context.user.id,
    });
    await audit(context.supabase, "esg.report_published", "esg_reports", report.id, {
      report_id: report.id,
    });
    return { status: "published" as const };
  });

/** Signed-URL download for the stored PDF. */
export const getEsgReportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reportIdSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);
    if (!report.pdf_path) httpError(404, "no_pdf", "No PDF stored for this report");
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(report.pdf_path, 300);
    if (error) throw error;
    return { url: signed?.signedUrl ?? null };
  });

/** Approval state for the drawer (no mutations). */
export const getEsgReportState = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reportIdSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const report = await loadReport(context.supabase, companyId, data.report_id);
    const snapshot = await loadEsgApproval(context.supabase, report.id);
    return {
      status: report.status,
      report_number: report.report_number,
      pdf_path: report.pdf_path ?? null,
      rejection_comment: report.rejection_comment,
      approval_status: snapshot?.status ?? null,
      current_step: snapshot?.current_step ?? null,
    };
  });
