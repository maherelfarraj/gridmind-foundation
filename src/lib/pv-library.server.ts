// P-150 — PV equipment library server-only helpers (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { PvCategory, PvEquipmentRow } from "@/lib/pv-library.schemas";

export const PV_DOCS_BUCKET = "documents";
export const PV_ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "csv", "xlsx"];
export const PV_WRITE_ROLES = [
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

export async function canWritePvLibrary(context: AuthContext): Promise<boolean> {
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", PV_WRITE_ROLES as any)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

export async function auditPvLibrary(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "pv_equipment_library",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // never fail on audit
  }
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "file"
  );
}

export function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function pvStoragePrefix(companyId: string, equipmentId: string): string {
  return `${companyId}/pv-library/${equipmentId}/`;
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function jsonArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function toPvRow(r: any): PvEquipmentRow {
  return {
    id: r.id,
    company_id: r.company_id,
    category: r.category as PvCategory,
    manufacturer: r.manufacturer,
    model: r.model,
    datasheet_path: r.datasheet_path ?? null,
    certifications: jsonArray(r.certifications) as any,
    warranties: jsonObject(r.warranties),
    degradation: jsonObject(r.degradation),
    electrical: jsonObject(r.electrical),
    temp_coefficients: jsonObject(r.temp_coefficients),
    dimensions: jsonObject(r.dimensions),
    limits: jsonObject(r.limits),
    docs: jsonArray(r.docs) as any,
    is_active: Boolean(r.is_active),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Drop null/undefined leaves so jsonb blocks stay tidy. */
export function compactRecord(value: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
