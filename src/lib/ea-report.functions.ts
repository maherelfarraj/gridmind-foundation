// P-169 — Study report export (thin wrapper: imports + server-fn declarations only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertEaReportAllowed,
  buildReportContext,
  loadStudyForReport,
  signReport,
  storeReport,
} from "@/lib/ea-report.server";
import { auditStudy } from "@/lib/ea-studies.server";
import { buildEaStudyReportPdf } from "@/lib/exports/ea-study-report-pdf";

const input = z.object({ studyId: z.string().uuid() });

/** Branded engineering report → documents bucket → documents row → audit. */
export const exportEaStudyReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudyForReport(context, data.studyId);
    await assertEaReportAllowed(context, study.project_id);

    const { payload, theme } = await buildReportContext(context, study);
    const bytes = buildEaStudyReportPdf(payload, theme);
    const stored = await storeReport(context, study, bytes);
    const signedUrl = await signReport(context, stored.storagePath);

    await auditStudy(context, "ea.report_exported", study.id, {
      study_number: study.study_number,
      revision: study.revision,
      storage_path: stored.storagePath,
      document_id: stored.documentId,
      bytes: bytes.byteLength,
    });

    return {
      fileName: stored.fileName,
      storagePath: stored.storagePath,
      documentId: stored.documentId,
      signedUrl,
    };
  });
