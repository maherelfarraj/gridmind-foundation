// P-168 — Server-only helpers for the protection schedule, relay settings and
// grid-code checklist. Kept out of the *.functions.ts module so the serverfn-split
// transform cannot drop runtime siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { eaError } from "@/lib/ea-studies.server";
import {
  mapSldObjectsToDevices,
  type MappedProtectionDevice,
  type SldProtectionObject,
} from "@/lib/ea/protection";

export const PROTECTION_TABLE = "ea_protection_devices";
export const RELAY_TABLE = "ea_relay_settings";
export const GC_TEMPLATE_TABLE = "ea_grid_code_templates";
export const GC_RESPONSE_TABLE = "ea_grid_code_responses";

export const PROTECTION_COLUMNS =
  "id, company_id, project_id, study_id, source, sld_object_id, tag, device_type, ansi_codes, " +
  "voltage_kv, rated_current_a, breaking_capacity_ka, making_capacity_ka, ct_ratio, vt_ratio, " +
  "curve_type, notes, sort_order, created_by, created_at, updated_at";

export const RELAY_COLUMNS =
  "id, company_id, project_id, device_id, revision, setting_group, function_code, pickup, " +
  "time_dial, curve, delay_s, unit, settings, set_by, set_at, notes, created_by, created_at";

export const GC_TEMPLATE_COLUMNS =
  "id, company_id, market, name, version, items, is_active, created_by, created_at, updated_at";

export const GC_RESPONSE_COLUMNS =
  "id, company_id, project_id, template_id, study_id, item_index, status, evidence, comment, " +
  "responded_by, created_at, updated_at";

/** Postgres/PostgREST codes that mean "this relation is not in the schema". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST106", "PGRST200"]);

export function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code ? MISSING_RELATION_CODES.has(code) : false;
}

/**
 * SOFT dependency probe for the Batch 16 SLD graph. The Data API cannot read
 * information_schema, so we probe the relation itself and treat a
 * missing-relation error as "the SLD module is not installed" — never a failure.
 */
export async function sldGraphAvailable(context: AuthContext): Promise<boolean> {
  const { error } = await context.supabase.from("sld_objects").select("id").limit(1);
  if (!error) return true;
  if (isMissingRelation(error)) return false;
  // A permission/RLS error still means the table exists.
  return true;
}

/** Newest SLD revision per drawing for a project, flattened to one object list. */
export async function loadSldProtectionObjects(
  context: AuthContext,
  projectId: string,
): Promise<SldProtectionObject[]> {
  const { data: drawings, error: drawErr } = await context.supabase
    .from("sld_drawings")
    .select("id, current_revision_id")
    .eq("project_id", projectId);
  if (drawErr) {
    if (isMissingRelation(drawErr)) return [];
    throw drawErr;
  }
  const revisionIds = ((drawings ?? []) as Array<{ current_revision_id: string | null }>)
    .map((d) => d.current_revision_id)
    .filter((v): v is string => Boolean(v));
  if (revisionIds.length === 0) return [];

  const { data, error } = await context.supabase
    .from("sld_objects")
    .select("id, symbol_type, tag, label, properties")
    .in("revision_id", revisionIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as SldProtectionObject[];
}

export type ProtectionUpsertRow = MappedProtectionDevice & {
  company_id: string;
  project_id: string;
  study_id: string | null;
  source: "sld";
  created_by: string | null;
};

export function buildProtectionRows(
  objects: SldProtectionObject[],
  scope: { companyId: string; projectId: string; studyId: string | null; userId: string | null },
): ProtectionUpsertRow[] {
  return mapSldObjectsToDevices(objects).map((d) => ({
    ...d,
    company_id: scope.companyId,
    project_id: scope.projectId,
    study_id: scope.studyId,
    source: "sld" as const,
    created_by: scope.userId,
  }));
}

/** Idempotent upsert on the (project_id, tag) natural key. */
export async function upsertProtectionRows(
  context: AuthContext,
  rows: ProtectionUpsertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await context.supabase
    .from(PROTECTION_TABLE)
    .upsert(rows as never, { onConflict: "project_id,tag" });
  if (error) throw error;
  return rows.length;
}

export async function loadDeviceScope(
  context: AuthContext,
  deviceId: string,
): Promise<{ id: string; company_id: string; project_id: string; tag: string }> {
  const { data, error } = await context.supabase
    .from(PROTECTION_TABLE)
    .select("id, company_id, project_id, tag")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) eaError(404, "device_not_found", "Protection device not found.");
  return data as unknown as { id: string; company_id: string; project_id: string; tag: string };
}

/** Highest existing revision for a device, or null when it has no settings yet. */
export async function latestSettingRevision(
  context: AuthContext,
  deviceId: string,
): Promise<number | null> {
  const { data, error } = await context.supabase
    .from(RELAY_TABLE)
    .select("revision")
    .eq("device_id", deviceId)
    .order("revision", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { revision: number } | undefined;
  return row ? row.revision : null;
}

export async function auditProtection(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    // audit must never fail the request
  }
}
