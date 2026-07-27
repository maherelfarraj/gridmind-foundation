// P-216 — Server-only helpers for the ESG activity register. Kept out of the
// *.functions.ts module so the server-fn split transform cannot drop siblings.
import type { Client } from "@/lib/cwp.server";
import { httpError } from "@/lib/cwp.server";
import {
  firstOfMonth,
  monthRange,
  resolveFactors,
  type EsgCategory,
  type FactorRow,
  type ResolvedFactor,
} from "@/lib/esg/activity.rules";

export const ESG_WRITER_ROLES = ["hse_admin", "company_admin"] as const;

const MISSING_RELATION = new Set(["42P01", "PGRST205", "PGRST106", "PGRST200"]);

export function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return Boolean(code && MISSING_RELATION.has(code));
}

export type ActivityRow = {
  id: string;
  act_number: string;
  project_id: string;
  period_month: string;
  category: EsgCategory;
  quantity: number;
  unit: string;
  source: string;
  source_id: string | null;
  evidence_path: string | null;
  notes: string | null;
  metadata: { fingerprint?: string } | null;
  entered_by: string | null;
  created_at: string;
};

export async function loadFactors(
  client: Client,
  companyId: string,
): Promise<Record<string, ResolvedFactor>> {
  const { data, error } = await client
    .from("esg_emission_factors")
    .select("id, company_id, category, unit, kg_co2e_per_unit, factor_source")
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw error;
  return resolveFactors((data ?? []) as unknown as FactorRow[]);
}

export async function loadActivities(
  client: Client,
  projectId: string,
  month: string,
): Promise<ActivityRow[]> {
  const { data, error } = await client
    .from("esg_activities")
    .select("*")
    .eq("project_id", projectId)
    .eq("period_month", firstOfMonth(month))
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

export async function enteredByNames(
  client: Client,
  rows: ActivityRow[],
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.entered_by).filter(Boolean))) as string[];
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
    out[p.id] = p.full_name || p.email;
  }
  return out;
}

export async function existingFingerprints(
  client: Client,
  projectId: string,
  month: string,
): Promise<Set<string>> {
  const rows = await loadActivities(client, projectId, month);
  const out = new Set<string>();
  for (const r of rows) {
    const fp = (r.metadata as { fingerprint?: string } | null)?.fingerprint;
    if (fp) out.add(fp);
  }
  return out;
}

export type NewActivity = {
  companyId: string;
  projectId: string;
  month: string;
  category: EsgCategory;
  quantity: number;
  unit: string;
  source: "manual" | "equipment_fuel" | "waste" | "import";
  sourceId?: string | null;
  notes?: string | null;
  evidencePath?: string | null;
  fingerprint?: string | null;
  enteredBy: string;
};

export async function insertActivities(
  client: Client,
  rows: NewActivity[],
): Promise<ActivityRow[]> {
  if (rows.length === 0) return [];
  const payload = rows.map((r) => ({
    company_id: r.companyId,
    project_id: r.projectId,
    act_number: "PENDING",
    period_month: firstOfMonth(r.month),
    category: r.category,
    quantity: r.quantity,
    unit: r.unit,
    source: r.source,
    source_id: r.sourceId ?? null,
    notes: r.notes ?? null,
    evidence_path: r.evidencePath ?? null,
    metadata: r.fingerprint ? { fingerprint: r.fingerprint } : {},
    entered_by: r.enteredBy,
  }));
  const { data, error } = await client
    .from("esg_activities")
    .insert(payload as never)
    .select("*");
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

/** Load a row and refuse mutation when it did not come from manual entry. */
export async function loadManualActivity(client: Client, id: string): Promise<ActivityRow> {
  const { data, error } = await client
    .from("esg_activities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Activity row not found");
  const row = data as unknown as ActivityRow;
  if (row.source !== "manual") {
    httpError(409, "imported_row", "Imported row — re-run the import to refresh");
  }
  return row;
}

export type EquipmentFuelAggregate =
  | { available: false }
  | { available: true; litres: number; recordCount: number };

export async function aggregateEquipmentFuel(
  client: Client,
  projectId: string,
  month: string,
): Promise<EquipmentFuelAggregate> {
  const { from, to } = monthRange(month);
  const { data, error } = await client
    .from("equipment_records")
    .select("fuel_litres")
    .eq("project_id", projectId)
    .gte("log_date", from)
    .lt("log_date", to)
    .limit(5000);
  if (error) {
    if (isMissingRelation(error)) return { available: false };
    throw error;
  }
  const rows = (data ?? []) as Array<{ fuel_litres: number | null }>;
  const litres = rows.reduce((sum, r) => sum + Number(r.fuel_litres ?? 0), 0);
  return { available: true, litres, recordCount: rows.length };
}

export type WasteSourceRow = { id: string; waste_type: string; qty: number; uom: string };

export async function loadWasteRows(
  client: Client,
  projectId: string,
  month: string,
): Promise<{ available: boolean; rows: WasteSourceRow[] }> {
  const { from, to } = monthRange(month);
  const { data, error } = await client
    .from("waste_tracking")
    .select("id, waste_type, qty, uom")
    .eq("project_id", projectId)
    .gte("disposal_date", from)
    .lt("disposal_date", to)
    .limit(2000);
  if (error) {
    if (isMissingRelation(error)) return { available: false, rows: [] };
    throw error;
  }
  return { available: true, rows: (data ?? []) as unknown as WasteSourceRow[] };
}

/** Which imports can run at all — a missing source table disables its button. */
export async function importAvailability(
  client: Client,
): Promise<{ equipmentFuel: boolean; waste: boolean }> {
  const [eq, waste] = await Promise.all([
    client.from("equipment_records").select("id").limit(1),
    client.from("waste_tracking").select("id").limit(1),
  ]);
  return {
    equipmentFuel: !(eq.error && isMissingRelation(eq.error)),
    waste: !(waste.error && isMissingRelation(waste.error)),
  };
}
