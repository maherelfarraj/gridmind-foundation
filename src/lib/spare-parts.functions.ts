// P-070 — Spare parts server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  applyStockDelta,
  materialCategoryEnum,
  sparePartSchema,
  stockAdjustSchema,
  type MaterialCategory,
} from "@/lib/procurement-extras-rules";

// ---------------------------------------------------------------------------
// row shape
// ---------------------------------------------------------------------------
export interface SparePartRow {
  id: string;
  company_id: string;
  part_number: string;
  name: string;
  description: string | null;
  category: MaterialCategory;
  compatible_equipment: string | null;
  uom: string;
  unit_cost: number | null;
  currency_code: string | null;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  reorder_point: number;
  safety_stock: number;
  lead_time_days: number | null;
  qty_on_hand: number;
  location: string | null;
  created_at: string;
  updated_at: string;
}

const WRITE_ROLES = [
  "procurement_admin",
  "procurement_officer",
  "om_admin",
  "company_admin",
] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function hasAnyWriteRole(context: AuthContext): Promise<boolean> {
  const results = await Promise.all(
    WRITE_ROLES.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "spare_parts",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toRow(r: any): SparePartRow {
  return {
    id: r.id,
    company_id: r.company_id,
    part_number: r.part_number,
    name: r.name,
    description: r.description,
    category: r.category,
    compatible_equipment: r.compatible_equipment,
    uom: r.uom,
    unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
    currency_code: r.currency_code,
    preferred_vendor_id: r.preferred_vendor_id,
    preferred_vendor_name: r.vendors?.name ?? null,
    reorder_point: Number(r.reorder_point ?? 0),
    safety_stock: Number(r.safety_stock ?? 0),
    lead_time_days: r.lead_time_days == null ? null : Number(r.lead_time_days),
    qty_on_hand: Number(r.qty_on_hand ?? 0),
    location: r.location,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getSparePartsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyWriteRole(context) };
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({
  search: z.string().trim().max(120).optional().nullable(),
  category: materialCategoryEnum.nullable().optional(),
});

export const listSpareParts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<SparePartRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("spare_parts")
      .select("*, vendors:preferred_vendor_id(name)")
      .order("part_number", { ascending: true });
    if (data.category) q = q.eq("category", data.category);
    if (data.search && data.search.length > 0) {
      const s = data.search.replace(/[%_]/g, "\\$&");
      q = q.or(`part_number.ilike.%${s}%,name.ilike.%${s}%,compatible_equipment.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toRow);
  });

// ---------------------------------------------------------------------------
// vendor picker
// ---------------------------------------------------------------------------
export const listVendorsForParts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; name: string }>> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("vendors")
      .select("id, name")
      .order("name", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, name: r.name }));
  });

// ---------------------------------------------------------------------------
// create / update / delete
// ---------------------------------------------------------------------------
export const upsertSparePart = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => sparePartSchema.parse(input))
  .handler(async ({ data, context }): Promise<SparePartRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);

    const payload: Record<string, unknown> = {
      company_id: companyId,
      part_number: data.part_number,
      name: data.name,
      description: data.description ?? null,
      category: data.category,
      compatible_equipment: data.compatible_equipment ?? null,
      uom: data.uom,
      unit_cost: data.unit_cost ?? null,
      currency_code: data.currency_code ?? null,
      preferred_vendor_id: data.preferred_vendor_id ?? null,
      reorder_point: data.reorder_point,
      safety_stock: data.safety_stock,
      lead_time_days: data.lead_time_days ?? null,
      qty_on_hand: data.qty_on_hand,
      location: data.location ?? null,
    };
    if (!data.id) payload.created_by = (context as any).user.id;

    const q = data.id
      ? context.supabase
          .from("spare_parts")
          .update(payload as any)
          .eq("id", data.id)
      : context.supabase.from("spare_parts").insert(payload as any);
    const { data: row, error } = await q.select("*, vendors:preferred_vendor_id(name)").single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      if ((error as any).code === "23505") httpError(409, "part_number_exists");
      throw error;
    }
    await audit(context, data.id ? "spare_part.update" : "spare_part.create", (row as any).id, {
      part_number: data.part_number,
      name: data.name,
    });
    return toRow(row);
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => stockAdjustSchema.parse(input))
  .handler(async ({ data, context }): Promise<SparePartRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");

    const { data: current, error: rErr } = await context.supabase
      .from("spare_parts")
      .select("qty_on_hand")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!current) httpError(404, "part_not_found");

    const nextQty = applyStockDelta(Number((current as any).qty_on_hand ?? 0), data.delta);

    const { data: row, error } = await context.supabase
      .from("spare_parts")
      .update({ qty_on_hand: nextQty } as any)
      .eq("id", data.id)
      .select("*, vendors:preferred_vendor_id(name)")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "spare_part.stock_adjust", data.id, {
      delta: data.delta,
      reason: data.reason,
      previous_qty: Number((current as any).qty_on_hand ?? 0),
      new_qty: nextQty,
    });
    return toRow(row);
  });

export const deleteSparePart = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyWriteRole(context))) httpError(403, "forbidden");
    const { error } = await context.supabase.from("spare_parts").delete().eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "spare_part.delete", data.id, {});
    return { ok: true };
  });
