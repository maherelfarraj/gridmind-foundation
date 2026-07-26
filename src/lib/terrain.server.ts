// P-160 — Server-only helpers for the terrain workspace (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export const TERRAIN_BUCKET = "documents";
export const TERRAIN_ALLOWED_EXTENSIONS = ["csv", "asc", "txt", "dem"];
export const TERRAIN_WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "construction_admin",
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

export async function canWriteTerrain(context: AuthContext): Promise<boolean> {
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", TERRAIN_WRITE_ROLES as any)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

export async function assertProjectVisible(
  context: AuthContext,
  projectId: string,
): Promise<{ id: string; company_id: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as any;
}

export async function auditTerrain(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "terrain_surfaces",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // never fail the request on audit
  }
}

export function terrainStoragePrefix(companyId: string, projectId: string): string {
  return `${companyId}/${projectId}/terrain/`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/** Best-effort cleanup: deleting the surface cascades points + contours. */
export async function rollbackSurface(context: AuthContext, surfaceId: string): Promise<void> {
  try {
    await context.supabase.from("terrain_surfaces").delete().eq("id", surfaceId);
  } catch {
    // swallow — the caller is already reporting the original failure
  }
}

export async function insertInChunks<T>(
  rows: T[],
  size: number,
  insert: (chunk: T[]) => Promise<{ error: unknown }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await insert(rows.slice(i, i + size));
    if (error) throw error;
  }
}
