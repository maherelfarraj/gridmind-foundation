// P-068 — Expediting log server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  computeLongLeadKpi,
  deriveStatus,
  EXPEDITING_STATUSES,
  importFromPoSchema,
  updateExpeditingSchema,
  type ExpeditingStatus,
  type LongLeadKpi,
} from "@/lib/expediting-rules";
import type { PoLine } from "@/lib/po-rules";
import type { GrnLine } from "@/lib/grn-rules";

// ---------------------------------------------------------------------------
// row shape
// ---------------------------------------------------------------------------
export interface ExpeditingRow {
  id: string;
  company_id: string;
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  project_id: string;
  project_name: string | null;
  po_line_no: number | null;
  item_description: string;
  is_long_lead: boolean;
  promised_delivery_date: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  site_need_date: string;
  current_eta: string | null;
  eta_confirmed: boolean;
  status: ExpeditingStatus;
  last_vendor_contact_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
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

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "expediting_logs",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    roles.map((r) =>
      context.supabase.rpc("has_company_role", { p_role: r as any }),
    ),
  );
  return Object.fromEntries(
    roles.map((r, i) => [r, Boolean(results[i]?.data)]),
  );
}

function toRow(r: any): ExpeditingRow {
  return {
    id: r.id,
    company_id: r.company_id,
    po_id: r.po_id,
    po_number: r.purchase_orders?.po_number ?? null,
    vendor_name: r.purchase_orders?.vendors?.name ?? null,
    project_id: r.project_id,
    project_name: r.projects?.name ?? null,
    po_line_no: r.po_line_no ?? null,
    item_description: r.item_description,
    is_long_lead: !!r.is_long_lead,
    promised_delivery_date: r.promised_delivery_date,
    delivery_window_start: r.delivery_window_start,
    delivery_window_end: r.delivery_window_end,
    site_need_date: r.site_need_date,
    current_eta: r.current_eta,
    eta_confirmed: !!r.eta_confirmed,
    status: r.status as ExpeditingStatus,
    last_vendor_contact_at: r.last_vendor_contact_at,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Sum received qty for a PO line across confirmed GRNs. */
async function receivedQtyForLine(
  context: AuthContext,
  poId: string,
  poLineNo: number | null,
): Promise<{ received: number; ordered: number }> {
  if (poLineNo == null) return { received: 0, ordered: 0 };
  const { data: po } = await context.supabase
    .from("purchase_orders")
    .select("lines")
    .eq("id", poId)
    .maybeSingle();
  const poLine = ((po as any)?.lines ?? []).find(
    (l: PoLine) => l.line_no === poLineNo,
  ) as PoLine | undefined;
  const ordered = Number(poLine?.qty ?? 0);

  const { data: grns } = await context.supabase
    .from("goods_receipts")
    .select("lines, status")
    .eq("po_id", poId)
    .in("status", ["confirmed", "has_defects", "closed"]);
  let received = 0;
  for (const g of ((grns ?? []) as any[])) {
    for (const l of ((g.lines ?? []) as GrnLine[])) {
      if (l.po_line_no === poLineNo) received += Number(l.qty_received || 0);
    }
  }
  return { received, ordered };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getExpeditingAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, [
      "procurement_admin",
      "procurement_officer",
      "company_admin",
    ]);
    return { canWrite: Object.values(flags).some(Boolean) };
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(EXPEDITING_STATUSES).nullable().optional(),
});

export const listExpediting = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ExpeditingRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("expediting_logs")
      .select(
        "*, purchase_orders:po_id(po_number, vendors:vendor_id(name)), projects:project_id(name)",
      )
      .order("site_need_date", { ascending: true });
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toRow);
  });

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------
export const getLongLeadKpi = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ projectId: z.string().uuid().nullable().optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<LongLeadKpi> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("expediting_logs")
      .select("is_long_lead, status, eta_confirmed");
    if (data.projectId) q = q.eq("project_id", data.projectId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return computeLongLeadKpi(
      ((rows ?? []) as any[]).map((r) => ({
        is_long_lead: !!r.is_long_lead,
        status: r.status as ExpeditingStatus,
        eta_confirmed: !!r.eta_confirmed,
      })),
    );
  });

// ---------------------------------------------------------------------------
// list open POs for the importer
// ---------------------------------------------------------------------------
export const listOpenPosForExpediting = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      Array<{
        id: string;
        po_number: string;
        vendor_name: string | null;
        project_id: string;
        project_name: string | null;
        required_by_date: string | null;
        lines: PoLine[];
      }>
    > => {
      requireSupabaseAuth(context);
      const { data, error } = await context.supabase
        .from("purchase_orders")
        .select(
          "id, po_number, project_id, required_by_date, lines, projects:project_id(name), vendors:vendor_id(name)",
        )
        .in("status", ["approved", "issued", "partially_received"])
        .order("po_number", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        po_number: r.po_number,
        vendor_name: r.vendors?.name ?? null,
        project_id: r.project_id,
        project_name: r.projects?.name ?? null,
        required_by_date: r.required_by_date,
        lines: (r.lines ?? []) as PoLine[],
      }));
    },
  );

// ---------------------------------------------------------------------------
// import from PO
// ---------------------------------------------------------------------------
export const importFromPo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => importFromPoSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ imported: number; skipped: number }> => {
      requireSupabaseAuth(context);
      const flags = await hasAnyRole(context, [
        "procurement_admin",
        "procurement_officer",
        "company_admin",
      ]);
      if (!Object.values(flags).some(Boolean)) httpError(403, "forbidden");
      const companyId = await currentCompanyId(context);

      const { data: po, error: pErr } = await context.supabase
        .from("purchase_orders")
        .select(
          "id, company_id, project_id, required_by_date, lines, po_number",
        )
        .eq("id", data.poId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!po || (po as any).company_id !== companyId)
        httpError(404, "po_not_found");

      const poLines = (((po as any).lines ?? []) as PoLine[]);
      if (poLines.length === 0) httpError(400, "po_has_no_lines");

      const { data: existing } = await context.supabase
        .from("expediting_logs")
        .select("po_line_no")
        .eq("po_id", data.poId);
      const existingLineNos = new Set(
        ((existing ?? []) as any[])
          .map((r) => r.po_line_no)
          .filter((n) => n != null),
      );

      const longLeadSet = new Set(data.longLeadLineNos);
      const defaultNeed =
        data.defaultSiteNeedDate ?? (po as any).required_by_date ?? null;

      const rowsToInsert: any[] = [];
      let skipped = 0;
      for (const l of poLines) {
        if (existingLineNos.has(l.line_no)) {
          skipped++;
          continue;
        }
        const need = l.site_need_date ?? defaultNeed;
        if (!need) {
          skipped++;
          continue;
        }
        rowsToInsert.push({
          company_id: companyId,
          po_id: (po as any).id,
          project_id: (po as any).project_id,
          po_line_no: l.line_no,
          item_description: l.description,
          is_long_lead: longLeadSet.has(l.line_no),
          promised_delivery_date: (po as any).required_by_date ?? null,
          site_need_date: need,
          status: "on_track",
          created_by: (context as any).user.id,
        });
      }

      if (rowsToInsert.length > 0) {
        const { error: iErr } = await context.supabase
          .from("expediting_logs")
          .insert(rowsToInsert as any);
        if (iErr) {
          if ((iErr as any).code === "42501") httpError(403, "forbidden");
          throw iErr;
        }
        await audit(context, "expediting.import", (po as any).id, {
          po_number: (po as any).po_number,
          imported: rowsToInsert.length,
          skipped,
        });
      }
      return { imported: rowsToInsert.length, skipped };
    },
  );

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
async function loadRow(context: AuthContext, id: string): Promise<any> {
  const { data, error } = await context.supabase
    .from("expediting_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "expediting_not_found");
  return data;
}

async function recomputeStatus(
  context: AuthContext,
  row: any,
): Promise<ExpeditingStatus> {
  const { received, ordered } = await receivedQtyForLine(
    context,
    row.po_id,
    row.po_line_no,
  );
  const fullyReceived = ordered > 0 && received >= ordered;
  return deriveStatus({
    current_eta: row.current_eta,
    site_need_date: row.site_need_date,
    delivery_window_start: row.delivery_window_start,
    delivery_window_end: row.delivery_window_end,
    last_vendor_contact_at: row.last_vendor_contact_at,
    fully_received: fullyReceived,
  });
}

export const updateExpediting = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateExpeditingSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ id: string; status: ExpeditingStatus }> => {
      requireSupabaseAuth(context);
      const current = await loadRow(context, data.id);
      const merged = { ...current, ...data.patch };
      const status = await recomputeStatus(context, merged);
      const { data: upd, error } = await context.supabase
        .from("expediting_logs")
        .update({ ...data.patch, status } as any)
        .eq("id", data.id)
        .select("id, status")
        .maybeSingle();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "expediting.update", data.id, {
        patch: data.patch,
        status,
      });
      return {
        id: (upd as any).id as string,
        status: (upd as any).status as ExpeditingStatus,
      };
    },
  );

export const logVendorContact = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ id: string; status: ExpeditingStatus }> => {
      requireSupabaseAuth(context);
      const current = await loadRow(context, data.id);
      const nowIso = new Date().toISOString();
      const merged = { ...current, last_vendor_contact_at: nowIso };
      const status = await recomputeStatus(context, merged);
      const { data: upd, error } = await context.supabase
        .from("expediting_logs")
        .update({ last_vendor_contact_at: nowIso, status } as any)
        .eq("id", data.id)
        .select("id, status")
        .maybeSingle();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "expediting.update", data.id, {
        vendor_contact: true,
        status,
      });
      return {
        id: (upd as any).id as string,
        status: (upd as any).status as ExpeditingStatus,
      };
    },
  );

export const deleteExpediting = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { error } = await context.supabase
      .from("expediting_logs")
      .delete()
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "expediting.update", data.id, { deleted: true });
    return { ok: true };
  });
