// P-113 — Manual export lock/unlock server fns.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

const EXPORT_TYPES = [
  "proposal_pdf",
  "proposal_pptx",
  "weekly_client_report",
  "om_report",
  "turnover_pack",
  "audit_pack",
  "csv",
] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

const LOCK_ROLES = ["company_admin", "project_admin", "finance_admin"] as const;

const lockInput = z.object({
  project_id: z.string().uuid(),
  export_type: z.enum(EXPORT_TYPES),
  reason: z.string().trim().min(3).max(500),
});
const unlockInput = z.object({ lock_id: z.string().uuid() });
const listInput = z.object({ project_id: z.string().uuid() });

async function assertLockRole(context: AuthContext) {
  for (const role of LOCK_ROLES) {
    const { data } = await context.supabase.rpc("has_company_role" as never, {
      p_role: role as never,
    } as never);
    if (data === true) return;
  }
  throw Object.assign(new Error("forbidden_role"), { statusCode: 403 });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const uid = context.user?.id;
  if (!uid) throw Object.assign(new Error("not_authenticated"), { statusCode: 401 });
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id?: string } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 403 });
  return cid;
}

async function audit(
  context: AuthContext,
  action: "export.locked" | "export.unlocked",
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log" as never, {
      p_action: action,
      p_entity: "project_export_locks",
      p_entity_id: entityId,
      p_metadata: metadata as never,
    } as never);
  } catch {
    /* non-fatal */
  }
}

export interface ExportLockRow {
  id: string;
  project_id: string;
  export_type: ExportType;
  reason: string;
  approval_instance_id: string | null;
  locked_by: string | null;
  locked_at: string;
  unlocked_at: string | null;
}

export const listExportLocks = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw))
  .handler(async ({ context, data }): Promise<ExportLockRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("project_export_locks" as never)
      .select(
        "id, project_id, export_type, reason, approval_instance_id, locked_by, locked_at, unlocked_at",
      )
      .eq("project_id", data.project_id as never)
      .is("unlocked_at", null as never)
      .order("locked_at", { ascending: false });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42P01") return [];
      throw error;
    }
    return (rows ?? []) as unknown as ExportLockRow[];
  });

export const lockExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => lockInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await assertLockRole(context);
    const companyId = await currentCompanyId(context);

    // If an active lock already exists for this type, return its id (idempotent).
    const { data: existing } = await context.supabase
      .from("project_export_locks" as never)
      .select("id")
      .eq("project_id", data.project_id as never)
      .eq("export_type", data.export_type as never)
      .is("unlocked_at", null as never)
      .maybeSingle();
    if (existing) return { id: (existing as { id: string }).id };

    const { data: inserted, error } = await context.supabase
      .from("project_export_locks" as never)
      .insert({
        company_id: companyId,
        project_id: data.project_id,
        export_type: data.export_type,
        reason: data.reason,
        locked_by: context.user.id,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    const id = (inserted as { id: string }).id;
    await audit(context, "export.locked", id, {
      project_id: data.project_id,
      export_type: data.export_type,
      reason: data.reason,
    });
    return { id };
  });

export const unlockExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => unlockInput.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertLockRole(context);
    const { data: updated, error } = await context.supabase
      .from("project_export_locks" as never)
      .update({ unlocked_at: new Date().toISOString() } as never)
      .eq("id", data.lock_id as never)
      .is("unlocked_at", null as never)
      .select("id, project_id, export_type")
      .maybeSingle();
    if (error) throw error;
    if (updated) {
      const row = updated as {
        id: string;
        project_id: string;
        export_type: string;
      };
      await audit(context, "export.unlocked", row.id, {
        project_id: row.project_id,
        export_type: row.export_type,
      });
    }
    return { ok: true };
  });
