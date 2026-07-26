// P-181 — Server-only helpers for field execution (work fronts, crew,
// equipment, materials, deliveries). Kept out of *.functions.ts so the
// createServerFn split transform can never drop sibling declarations.
import type { Client } from "@/lib/cwp.server";
import { httpError } from "@/lib/cwp.server";

export interface WorkFrontRow {
  id: string;
  project_id: string;
  name: string;
  area: string | null;
  discipline: string;
  is_active: boolean;
}

export interface CrewRow {
  id: string;
  work_front_id: string;
  assignment_date: string;
  trade: string;
  contractor: string | null;
  headcount: number;
  cwp_id: string | null;
  notes: string | null;
}

export interface EquipmentRow {
  id: string;
  dpr_id: string | null;
  equipment_tag: string;
  description: string | null;
  category: string | null;
  status: string;
  log_date: string;
  hours: number | string;
  operator_name: string | null;
  fuel_litres: number | string | null;
  notes: string | null;
}

export interface MaterialRow {
  id: string;
  dpr_id: string;
  cwp_id: string | null;
  material: string;
  qty: number | string;
  uom: string;
  batch_serial_id: string | null;
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  project_id: string;
  purchase_order_id: string | null;
  reference: string | null;
  status: string;
  expected_date: string | null;
  delivered_at: string | null;
  carrier: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function projectScope(
  client: Client,
  projectId: string,
): Promise<{ id: string; company_id: string; name: string; code: string | null }> {
  const { data, error } = await client
    .from("projects")
    .select("id, company_id, name, code")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string; code: string | null };
}

export async function dprScope(
  client: Client,
  dprId: string,
): Promise<{
  id: string;
  company_id: string;
  project_id: string;
  report_date: string;
  status: string;
}> {
  const { data, error } = await client
    .from("construction_daily_reports")
    .select("id, company_id, project_id, report_date, status")
    .eq("id", dprId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "dpr_not_found");
  const row = data as {
    id: string;
    company_id: string;
    project_id: string;
    report_date: string;
    status: string;
  };
  return row;
}

export function assertDprOpen(status: string): void {
  if (status !== "draft") httpError(409, "not_draft", "This daily report is no longer editable");
}

export async function loadWorkFronts(
  client: Client,
  projectId: string,
): Promise<{ fronts: WorkFrontRow[]; crew: CrewRow[] }> {
  const [frontRes, crewRes] = await Promise.all([
    client
      .from("work_fronts")
      .select("id, project_id, name, area, discipline, is_active")
      .eq("project_id", projectId)
      .order("name"),
    client
      .from("crew_assignments")
      .select("id, work_front_id, assignment_date, trade, contractor, headcount, cwp_id, notes")
      .eq("project_id", projectId)
      .order("assignment_date", { ascending: false })
      .limit(2000),
  ]);
  if (frontRes.error) throw frontRes.error;
  if (crewRes.error) throw crewRes.error;
  return {
    fronts: (frontRes.data ?? []) as unknown as WorkFrontRow[],
    crew: (crewRes.data ?? []) as unknown as CrewRow[],
  };
}

export async function loadEquipment(client: Client, dprId: string): Promise<EquipmentRow[]> {
  const { data, error } = await client
    .from("equipment_records")
    .select(
      "id, dpr_id, equipment_tag, description, category, status, log_date, hours, operator_name, fuel_litres, notes",
    )
    .eq("dpr_id", dprId)
    .order("equipment_tag");
  if (error) throw error;
  return (data ?? []) as unknown as EquipmentRow[];
}

export async function loadMaterials(client: Client, dprId: string): Promise<MaterialRow[]> {
  const { data, error } = await client
    .from("material_consumption")
    .select("id, dpr_id, cwp_id, material, qty, uom, batch_serial_id, created_at")
    .eq("dpr_id", dprId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MaterialRow[];
}

export async function loadDeliveries(client: Client, projectId: string): Promise<DeliveryRow[]> {
  const { data, error } = await client
    .from("delivery_tracking")
    .select(
      "id, project_id, purchase_order_id, reference, status, expected_date, delivered_at, carrier, notes, created_at, updated_at",
    )
    .eq("project_id", projectId)
    .order("expected_date", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as DeliveryRow[];
}

export async function loadPurchaseOrderOptions(
  client: Client,
  projectId: string,
): Promise<Array<{ id: string; po_number: string; vendor_name: string | null }>> {
  const { data, error } = await client
    .from("purchase_orders")
    .select("id, po_number, vendors(name)")
    .eq("project_id", projectId)
    .order("po_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string;
    po_number: string;
    vendors: { name: string } | null;
  }>).map((r) => ({
    id: r.id,
    po_number: r.po_number,
    vendor_name: r.vendors?.name ?? null,
  }));
}
