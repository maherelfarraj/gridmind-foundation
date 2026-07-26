// P-152 — Server-only helpers for PV layouts (kept out of the serverfn-split
// module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  defaultLayoutParams,
  defaultLayoutTotals,
  type PvLayoutBlockRow,
  type PvLayoutRow,
} from "@/lib/pv-layout.schemas";

export const PV_LAYOUT_WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
];

export function httpError(status: number, code: string, message?: string, extra?: object): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code, ...(extra ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Maps a Postgres error raised by the layout RPCs onto an HTTP response. */
export function mapLayoutRpcError(error: { code?: string; message?: string }): never {
  const message = error.message ?? "";
  if (message.includes("forbidden_role") || message.includes("forbidden_company")) {
    httpError(403, "forbidden", "You do not have permission to edit PV layouts.");
  }
  if (message.includes("layout_not_found") || message.includes("project_not_found")) {
    httpError(404, "not_found", "Layout not found.");
  }
  if (message.includes("layout_locked") || message.includes("invalid_status")) {
    httpError(409, "layout_locked", "Only draft layouts can be edited.");
  }
  if (message.includes("name_required")) {
    httpError(400, "name_required", "Layout name is required.");
  }
  if (error.code === "42501") httpError(403, "forbidden");
  if (error.code === "23505") httpError(409, "duplicate_layout");
  throw Object.assign(new Error(message || "layout_rpc_failed"), error);
}

export async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company", "No active company for user.");
  return companyId as string;
}

export async function canWritePvLayout(context: AuthContext): Promise<boolean> {
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", PV_LAYOUT_WRITE_ROLES as any)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

export function toLayoutRow(row: any): PvLayoutRow {
  return {
    id: row.id,
    company_id: row.company_id,
    project_id: row.project_id,
    site_config_id: row.site_config_id ?? null,
    name: row.name,
    version: Number(row.version ?? 1),
    layout_number: row.layout_number ?? null,
    status: row.status,
    params: { ...defaultLayoutParams(), ...((row.params ?? {}) as object) },
    totals: { ...defaultLayoutTotals(), ...((row.totals ?? {}) as object) },
    approval_instance_id: row.approval_instance_id ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toBlockRow(row: any): PvLayoutBlockRow {
  return {
    id: row.id,
    company_id: row.company_id,
    layout_id: row.layout_id,
    block_type: row.block_type,
    label: row.label ?? null,
    geometry: {
      polygon: (row.geometry?.polygon ?? []) as [number, number][],
      rotation_deg: Number(row.geometry?.rotation_deg ?? 0),
    },
    equipment_id: row.equipment_id ?? null,
    module_rows: row.module_rows ?? null,
    modules_per_row: row.modules_per_row ?? null,
    module_count: Number(row.module_count ?? 0),
    dc_kwp: Number(row.dc_kwp ?? 0),
    sort_order: Number(row.sort_order ?? 0),
  };
}

export async function auditPvLayout(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "pv_layouts",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    } as any);
  } catch {
    // Auditing must never break the caller's write.
  }
}
