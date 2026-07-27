// P-113 — Real export lock gate. Backed by public.project_export_locks and the
// approval engine (approval_rules.blocks_export). All export server fns and
// client-side export triggers must call assertExportAllowed before generating.
//
// Signature is (supabase, projectId, exportType). Project-less exports (CRM
// CSV, cross-project rollups) pass null and no-op.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  currentActorId,
  exportBlockedAuditRow,
  writeBlockedAudit,
} from "@/lib/blocked-audit";

export type ExportType =
  | "proposal_pdf"
  | "proposal_pptx"
  | "weekly_client_report"
  | "om_report"
  | "turnover_pack"
  | "audit_pack"
  | "sld_schedule"
  | "sld_drawing"
  | "sld_revision_diff"
  | "ea_study_report"
  | "civil_geojson"
  | "civil_kml"
  | "wip_report"
  | "gl_export"
  | "esg_report"
  | "timesheet_report"
  | "timesheet_payroll"
  | "csv";

export interface ExportLockedError extends Error {
  statusCode: 423;
  code: "export_locked";
  exportType: ExportType;
}

function isPgMessage(err: unknown, prefix: string): boolean {
  if (!err || typeof err !== "object") return false;
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" && m.startsWith(prefix);
}

export async function assertExportAllowed(
  supabase: SupabaseClient,
  projectId: string | null | undefined,
  exportType: ExportType,
): Promise<void> {
  // Project-less exports have no lock scope.
  if (!projectId) return;

  // Auto-release completed approval locks first (best-effort; ignore missing).
  const sync = await supabase.rpc(
    "sync_export_locks" as never,
    {
      p_project_id: projectId,
    } as never,
  );
  if (sync.error) {
    const code = (sync.error as { code?: string }).code;
    // 42P01 = table missing (pre-migration env) → treat as unlocked.
    if (code === "42P01") return;
    // Other RPC errors are non-fatal for the release step — the guard below
    // is the source of truth.
  }

  const { error } = await supabase.rpc(
    "assert_export_unlocked" as never,
    {
      p_project_id: projectId,
      p_export_type: exportType,
    } as never,
  );
  if (!error) return;

  const code = (error as { code?: string }).code;
  if (code === "42P01" || code === "42883") return; // migration not applied yet

  if (isPgMessage(error, "export_locked:")) {
    // Day 7 — blocked-attempt audit. Exactly one row, then the same typed 423.
    const { data: proj } = await supabase
      .from("projects")
      .select("company_id")
      .eq("id", projectId)
      .maybeSingle();
    const companyId = (proj as { company_id?: string } | null)?.company_id;
    if (companyId) {
      await writeBlockedAudit(
        supabase,
        exportBlockedAuditRow({
          companyId,
          actorId: await currentActorId(supabase),
          projectId,
          exportType,
        }),
      );
    }
    const err = new Error("Export blocked: approval pending") as ExportLockedError;
    err.statusCode = 423;
    err.code = "export_locked";
    err.exportType = exportType;
    throw err;
  }
  throw error;
}
