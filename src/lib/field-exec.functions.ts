// P-181 — Field execution server functions. Thin wrappers only; helpers live
// in field-exec.server.ts / field-exec.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, currentCompanyId, hasAnyRole, httpError } from "@/lib/cwp.server";
import {
  assertDprOpen,
  dprScope,
  loadDeliveries,
  loadEquipment,
  loadMaterials,
  loadPurchaseOrderOptions,
  loadWorkFronts,
  projectScope,
  type CrewRow,
  type DeliveryRow,
  type EquipmentRow,
  type MaterialRow,
  type WorkFrontRow,
} from "@/lib/field-exec.server";
import {
  crewAssignmentInput,
  deliveryInput,
  equipmentRecordInput,
  FIELD_WRITER_ROLES,
  materialConsumptionInput,
  workFrontInput,
} from "@/lib/field-exec.rules";

const uuid = z.string().uuid();

export const getFieldAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyRole(context.supabase, FIELD_WRITER_ROLES) };
  });

export const listWorkFronts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(async ({ data, context }): Promise<{ fronts: WorkFrontRow[]; crew: CrewRow[] }> => {
    requireSupabaseAuth(context);
    return loadWorkFronts(context.supabase, data.projectId);
  });

export const upsertWorkFront = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => workFrontInput.parse(raw))
  .handler(async ({ data, context }): Promise<WorkFrontRow> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    const project = await projectScope(context.supabase, data.projectId);
    const row = {
      company_id: project.company_id,
      project_id: project.id,
      name: data.name,
      area: data.area ?? null,
      discipline: data.discipline,
      is_active: data.isActive,
      created_by: context.user!.id,
    };
    const query = data.id
      ? context.supabase
          .from("work_fronts")
          .update(row as never)
          .eq("id", data.id)
      : context.supabase.from("work_fronts").insert(row as never);
    const { data: saved, error } = await query
      .select("id, project_id, name, area, discipline, is_active")
      .maybeSingle();
    if (error) throw error;
    return saved as unknown as WorkFrontRow;
  });

export const setCrewAssignment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => crewAssignmentInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    const { data: front, error: frontErr } = await context.supabase
      .from("work_fronts")
      .select("id, company_id, project_id")
      .eq("id", data.workFrontId)
      .maybeSingle();
    if (frontErr) throw frontErr;
    if (!front) httpError(404, "work_front_not_found");
    const scope = front as { id: string; company_id: string; project_id: string };

    if (data.headcount === 0) {
      const { error } = await context.supabase
        .from("crew_assignments")
        .delete()
        .eq("work_front_id", scope.id)
        .eq("assignment_date", data.assignmentDate)
        .eq("trade", data.trade);
      if (error) throw error;
      return { ok: true };
    }

    const { error } = await context.supabase.from("crew_assignments").upsert(
      {
        company_id: scope.company_id,
        project_id: scope.project_id,
        work_front_id: scope.id,
        assignment_date: data.assignmentDate,
        trade: data.trade,
        contractor: data.contractor ?? null,
        headcount: data.headcount,
        cwp_id: data.cwpId ?? null,
        notes: data.notes ?? null,
        created_by: context.user!.id,
      } as never,
      { onConflict: "company_id,project_id,work_front_id,assignment_date,trade" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const listEquipmentRecords = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ dprId: uuid }).parse(raw))
  .handler(async ({ data, context }): Promise<EquipmentRow[]> => {
    requireSupabaseAuth(context);
    return loadEquipment(context.supabase, data.dprId);
  });

export const upsertEquipmentRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => equipmentRecordInput.parse(raw))
  .handler(async ({ data, context }): Promise<EquipmentRow> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    const dpr = await dprScope(context.supabase, data.dprId);
    assertDprOpen(dpr.status);
    const row = {
      company_id: dpr.company_id,
      project_id: dpr.project_id,
      dpr_id: dpr.id,
      equipment_tag: data.equipmentTag,
      description: data.description ?? null,
      category: data.category ?? null,
      status: data.status,
      log_date: dpr.report_date,
      hours: data.hours,
      operator_name: data.operatorName ?? null,
      fuel_litres: data.fuelLitres ?? null,
      notes: data.notes ?? null,
      created_by: context.user!.id,
    };
    const query = data.id
      ? context.supabase
          .from("equipment_records")
          .update(row as never)
          .eq("id", data.id)
      : context.supabase
          .from("equipment_records")
          .upsert(row as never, { onConflict: "company_id,equipment_tag,log_date" });
    const { data: saved, error } = await query
      .select(
        "id, dpr_id, equipment_tag, description, category, status, log_date, hours, operator_name, fuel_litres, notes",
      )
      .maybeSingle();
    if (error) throw error;
    return saved as unknown as EquipmentRow;
  });

export const deleteEquipmentRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: uuid, dprId: uuid }).parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    const dpr = await dprScope(context.supabase, data.dprId);
    assertDprOpen(dpr.status);
    const { error } = await context.supabase.from("equipment_records").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const listMaterialConsumption = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ dprId: uuid }).parse(raw))
  .handler(async ({ data, context }): Promise<MaterialRow[]> => {
    requireSupabaseAuth(context);
    return loadMaterials(context.supabase, data.dprId);
  });

export const addMaterialConsumption = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => materialConsumptionInput.parse(raw))
  .handler(async ({ data, context }): Promise<MaterialRow> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    const dpr = await dprScope(context.supabase, data.dprId);
    assertDprOpen(dpr.status);
    const { data: saved, error } = await context.supabase
      .from("material_consumption")
      .insert({
        company_id: dpr.company_id,
        project_id: dpr.project_id,
        dpr_id: dpr.id,
        cwp_id: data.cwpId ?? null,
        material: data.material,
        qty: data.qty,
        uom: data.uom,
        batch_serial_id: data.batchSerialId ?? null,
        recorded_by: context.user!.id,
      } as never)
      .select("id, dpr_id, cwp_id, material, qty, uom, batch_serial_id, created_at")
      .maybeSingle();
    if (error) throw error;
    return saved as unknown as MaterialRow;
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      deliveries: DeliveryRow[];
      purchaseOrders: Array<{ id: string; po_number: string; vendor_name: string | null }>;
    }> => {
      requireSupabaseAuth(context);
      const [deliveries, purchaseOrders] = await Promise.all([
        loadDeliveries(context.supabase, data.projectId),
        loadPurchaseOrderOptions(context.supabase, data.projectId),
      ]);
      return { deliveries, purchaseOrders };
    },
  );

export const upsertDelivery = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => deliveryInput.parse(raw))
  .handler(async ({ data, context }): Promise<DeliveryRow> => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, FIELD_WRITER_ROLES);
    await currentCompanyId(context.supabase, context.user!.id);
    const project = await projectScope(context.supabase, data.projectId);
    const delivered =
      data.status === "delivered" || data.status === "partially_delivered"
        ? (data.deliveredAt ?? new Date().toISOString())
        : (data.deliveredAt ?? null);
    const row = {
      company_id: project.company_id,
      project_id: project.id,
      purchase_order_id: data.purchaseOrderId ?? null,
      reference: data.reference ?? null,
      status: data.status,
      expected_date: data.expectedDate ?? null,
      delivered_at: delivered,
      carrier: data.carrier ?? null,
      notes: data.notes ?? null,
      created_by: context.user!.id,
    };
    const query = data.id
      ? context.supabase
          .from("delivery_tracking")
          .update(row as never)
          .eq("id", data.id)
      : context.supabase.from("delivery_tracking").insert(row as never);
    const { data: saved, error } = await query
      .select(
        "id, project_id, purchase_order_id, reference, status, expected_date, delivered_at, carrier, notes, created_at, updated_at",
      )
      .maybeSingle();
    if (error) throw error;
    return saved as unknown as DeliveryRow;
  });
