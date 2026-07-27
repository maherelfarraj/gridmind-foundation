// P-197 — Revenue recognition (WIP) server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { audit } from "@/lib/payments.server";
import { GetWipReportSchema, type WipAccessLevel } from "@/lib/wip.rules";
import {
  loadWipBranding,
  loadWipDataset,
  resolveWipAccess,
  type WipBranding,
  type WipCompany,
  type WipDataset,
  type WipProjectPick,
} from "@/lib/wip.server";

export type { WipBranding, WipCompany, WipDataset, WipProjectPick };

// ---------------------------------------------------------------------------
// WIP schedule — readable by any company member (RLS scopes the rows)
// ---------------------------------------------------------------------------
export const getWipReport = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GetWipReportSchema.parse(input))
  .handler(async ({ data, context }): Promise<WipDataset> => {
    requireSupabaseAuth(context);
    return loadWipDataset(context, data);
  });

// ---------------------------------------------------------------------------
// Access level for the page gate
// ---------------------------------------------------------------------------
export const getWipAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ level: WipAccessLevel }> => {
    requireSupabaseAuth(context);
    return { level: await resolveWipAccess(context) };
  });

// ---------------------------------------------------------------------------
// Project picker
// ---------------------------------------------------------------------------
export const listWipProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<WipProjectPick[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as WipProjectPick[];
  });

// ---------------------------------------------------------------------------
// PDF export gate: export lock FIRST, then branding + audit
// ---------------------------------------------------------------------------
const ExportSchema = z.object({
  project_id: z.string().uuid(),
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const prepareWipExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ExportSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ branding: WipBranding; company: WipCompany; ok: true }> => {
      await assertExportAllowed(context.supabase, data.project_id, "wip_report");
      requireSupabaseAuth(context);
      const { branding, company } = await loadWipBranding(context);
      await audit(context, "report.wip_export", "projects", data.project_id, {
        as_of_date: data.as_of_date,
      });
      return { branding, company, ok: true };
    },
  );
