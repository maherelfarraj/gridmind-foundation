// GC-09 — Portfolio audit trail server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  loadPortfolioAudit,
  requirePortfolioAuditAccess,
  auditExportLogged,
  type PortfolioAuditData,
} from "@/lib/portfolio-audit.server";
import { auditFilterSchema, buildAuditCsv } from "@/lib/portfolio-audit.rules";

export type { PortfolioAuditData };

export const getPortfolioAudit = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => auditFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioAuditData> => {
    requireSupabaseAuth(context);
    return loadPortfolioAudit(context, data);
  });

export const getPortfolioAuditCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => auditFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    const companyId = await requirePortfolioAuditAccess(context);
    // Export always starts at the first page of the *filtered* set so the CSV
    // is not silently scoped to whichever page the operator was viewing.
    const payload = await loadPortfolioAudit(context, { ...data, page: 1, page_size: 200 });
    await auditExportLogged(context, companyId, "csv", {
      rows: payload.events.length,
      period: data.period ?? null,
    });
    return {
      filename: `portfolio-audit-${data.from ?? "all"}-${data.to ?? "now"}.csv`,
      csv: buildAuditCsv(payload.events),
    };
  });
