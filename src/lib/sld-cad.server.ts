// P-138 — Server-only helpers for the SLD CAD canvas workspace.
// Kept out of the *.functions.ts module so server-fn splitting cannot drop them.

export const CAD_WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;

export const LOCKED_STATUSES = ["ifc", "as_built", "superseded"] as const;

export function cadHttpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export type CadDrawing = {
  id: string;
  company_id: string;
  project_id: string;
  drawing_number: string;
  title: string;
  status: string;
  sheet_size: string;
  border_template: string;
  locked: boolean;
  current_revision_id: string | null;
  created_by?: string | null;
  updated_at: string;
};

export async function loadCadDrawing(context: any, drawingId: string): Promise<CadDrawing> {
  const { data, error } = await context.supabase
    .from("sld_drawings")
    .select(
      "id, company_id, project_id, drawing_number, title, status, sheet_size, border_template, locked, current_revision_id, updated_at",
    )
    .eq("id", drawingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) cadHttpError(404, "drawing_not_found", "Drawing not found.");
  return data as CadDrawing;
}

export async function hasCadWriteRole(context: any, companyId: string): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", CAD_WRITE_ROLES as unknown as string[])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export function assertDrawingEditable(drawing: CadDrawing) {
  if (drawing.locked) {
    cadHttpError(409, "drawing_locked", "This drawing is locked and cannot be edited.");
  }
  if ((LOCKED_STATUSES as readonly string[]).includes(drawing.status)) {
    cadHttpError(
      409,
      "drawing_status_locked",
      `Drawings with status "${drawing.status}" are read-only. Create a new revision to continue.`,
    );
  }
}

export async function cadAudit(
  context: any,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "sld_drawings",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // auditing must never break a save
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Objects removed from a revision are flagged, never destroyed (no DELETE grants). */
export const REMOVED_FLAG = "__removed";

export function isRemoved(properties: unknown): boolean {
  return Boolean(
    properties && typeof properties === "object" && (properties as any)[REMOVED_FLAG] === true,
  );
}
