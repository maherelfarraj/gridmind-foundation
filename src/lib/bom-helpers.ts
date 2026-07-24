// P-057 — Server-only helpers for BOM server functions.
// Kept in a .server.ts sibling so createServerFn handlers stay self-contained
// (see tanstack-serverfn-splitting knowledge).
import { z } from "zod";
import { BOM_CATEGORIES, type BomCategory } from "@/lib/calculators/bom";

export const BOM_WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;

export const BOM_RELEASE_ROLES = [
  "engineering_admin",
  "company_admin",
  "super_admin",
] as const;

export function bomHttpError(
  status: number,
  code: string,
  message?: string,
): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function loadBomProject(
  context: any,
  projectId: string,
): Promise<{ id: string; company_id: string; capacity_mw: number | null; name: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, capacity_mw, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) bomHttpError(404, "project_not_found");
  return data as any;
}

export async function loadSnapshotWithProject(
  context: any,
  snapshotId: string,
): Promise<{
  id: string;
  company_id: string;
  project_id: string;
  status: "draft" | "released" | "superseded";
  version: number;
}> {
  const { data, error } = await context.supabase
    .from("bom_snapshots")
    .select("id, company_id, project_id, status, version")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw error;
  if (!data) bomHttpError(404, "snapshot_not_found");
  return data as any;
}

export async function assertBomRole(
  context: any,
  companyId: string,
  roles: readonly string[],
) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", roles as any)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) bomHttpError(403, "forbidden");
}

export async function audit(
  context: any,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    /* never break the write */
  }
}

// -------- Zod schemas ------------------------------------------------------

export const projectIdInput = z.object({ projectId: z.string().uuid() });

export const snapshotIdInput = z.object({ snapshotId: z.string().uuid() });

export const updateLineInput = z.object({
  lineId: z.string().uuid(),
  qty: z.number().min(0).max(1e12).optional(),
  buffer_pct: z.number().min(-50).max(200).optional(),
  unit_cost: z.number().min(0).max(1e12).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const bomCategoryEnum = z.enum(BOM_CATEGORIES);
export type BomCategoryEnum = z.infer<typeof bomCategoryEnum>;

export function isBomCategory(v: unknown): v is BomCategory {
  return typeof v === "string" && (BOM_CATEGORIES as readonly string[]).includes(v);
}
