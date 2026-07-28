// P-066 — Goods Receipt (GRN) server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  GRN_STATUSES,
  assertGrnPhotoPath,
  computePoStatusAfterGrn,
  countDefects,
  deriveGrnStatus,
  grnDraftPayload,
  nextGrnNumber,
  overReceivedLines,
  type GrnLine,
  type GrnStatus,
  type ReceivableLine,
} from "@/lib/grn-rules";
import type { PoLine, PoStatus } from "@/lib/po-rules";

// ---------------------------------------------------------------------------
// row + helpers
// ---------------------------------------------------------------------------
export interface GrnRow {
  id: string;
  company_id: string;
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  project_id: string;
  project_name: string | null;
  grn_number: string;
  status: GrnStatus;
  lines: GrnLine[];
  defects_count: number;
  photos: string[];
  photo_urls: string[];
  notes: string | null;
  received_by: string | null;
  received_by_name: string | null;
  received_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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
      p_entity: "goods_receipts",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* audit is best-effort */
  }
}

async function loadPo(
  context: AuthContext,
  poId: string,
): Promise<{
  id: string;
  company_id: string;
  project_id: string;
  status: PoStatus;
  po_number: string;
  lines: PoLine[];
}> {
  const { data, error } = await context.supabase
    .from("purchase_orders")
    .select("id, company_id, project_id, status, po_number, lines")
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "po_not_found");
  return {
    id: (data as any).id,
    company_id: (data as any).company_id,
    project_id: (data as any).project_id,
    status: (data as any).status as PoStatus,
    po_number: (data as any).po_number,
    lines: ((data as any).lines ?? []) as PoLine[],
  };
}

async function receivableFor(
  context: AuthContext,
  poId: string,
): Promise<{
  po: Awaited<ReturnType<typeof loadPo>>;
  receivable: ReceivableLine[];
  confirmedLines: GrnLine[];
}> {
  const po = await loadPo(context, poId);

  const { data: rows, error } = await context.supabase
    .from("goods_receipts")
    .select("status, lines")
    .eq("po_id", poId)
    .in("status", ["confirmed", "has_defects", "closed"]);
  if (error) throw error;

  const confirmedLines: GrnLine[] = [];
  for (const r of (rows ?? []) as any[]) {
    for (const l of (r.lines ?? []) as GrnLine[]) confirmedLines.push(l);
  }
  const receivedByNo = new Map<number, number>();
  for (const l of confirmedLines) {
    receivedByNo.set(
      l.po_line_no,
      (receivedByNo.get(l.po_line_no) ?? 0) + Number(l.qty_received || 0),
    );
  }
  const receivable: ReceivableLine[] = po.lines.map((pl) => {
    const already = receivedByNo.get(pl.line_no) ?? 0;
    const remaining = Math.max(0, Number(pl.qty || 0) - already);
    return {
      po_line_no: pl.line_no,
      description: pl.description,
      uom: pl.uom,
      qty_ordered: Number(pl.qty || 0),
      qty_already_received: already,
      qty_remaining: remaining,
    };
  });
  return { po, receivable, confirmedLines };
}

async function signPhotoPaths(context: AuthContext, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  try {
    const { data } = await context.supabase.storage.from("photos").createSignedUrls(paths, 600);
    return (data ?? []).map((d: any) => d?.signedUrl ?? "");
  } catch {
    return paths.map(() => "");
  }
}

async function toGrnRow(context: AuthContext, r: any): Promise<GrnRow> {
  const photos = ((r.photos ?? []) as string[]).filter(Boolean);
  const photo_urls = await signPhotoPaths(context, photos);
  return {
    id: r.id,
    company_id: r.company_id,
    po_id: r.po_id,
    po_number: r.purchase_orders?.po_number ?? null,
    vendor_name: r.purchase_orders?.vendors?.name ?? null,
    project_id: r.project_id,
    project_name: r.projects?.name ?? null,
    grn_number: r.grn_number,
    status: r.status,
    lines: (r.lines ?? []) as GrnLine[],
    defects_count: Number(r.defects_count ?? 0),
    photos,
    photo_urls,
    notes: r.notes,
    received_by: r.received_by,
    received_by_name: r.received_by_profile?.full_name ?? null,
    received_at: r.received_at,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// list / receivable
// ---------------------------------------------------------------------------
const listInput = z.object({
  search: z.string().nullable().optional(),
  status: z.enum(GRN_STATUSES).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  poId: z.string().uuid().nullable().optional(),
});

export const listGrns = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<GrnRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("goods_receipts")
      .select(
        "*, purchase_orders:po_id(po_number, vendors:vendor_id(name)), projects:project_id(name)",
      )
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.poId) q = q.eq("po_id", data.poId);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.ilike("grn_number", `%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return Promise.all(((rows ?? []) as any[]).map((r) => toGrnRow(context, r)));
  });

export const getGrn = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ grnId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<GrnRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("goods_receipts")
      .select(
        "*, purchase_orders:po_id(po_number, vendors:vendor_id(name)), projects:project_id(name)",
      )
      .eq("id", data.grnId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "grn_not_found");
    return toGrnRow(context, row);
  });

export const getReceivableForPo = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      po_id: string;
      po_number: string;
      po_status: PoStatus;
      project_id: string;
      receivable: ReceivableLine[];
    }> => {
      requireSupabaseAuth(context);
      const { po, receivable } = await receivableFor(context, data.poId);
      return {
        po_id: po.id,
        po_number: po.po_number,
        po_status: po.status,
        project_id: po.project_id,
        receivable,
      };
    },
  );

// ---------------------------------------------------------------------------
// draft lifecycle
// ---------------------------------------------------------------------------
export const createDraftGrn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ id: string; company_id: string; project_id: string }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const po = await loadPo(context, data.poId);
      if (po.company_id !== companyId) httpError(404, "po_not_found");
      if (!["issued", "partially_received"].includes(po.status)) {
        httpError(
          409,
          "po_not_receivable",
          "PO must be issued or partially received to receive goods.",
        );
      }

      const { data: inserted, error } = await context.supabase
        .from("goods_receipts")
        .insert({
          company_id: companyId,
          po_id: po.id,
          project_id: po.project_id,
          grn_number: `DRAFT-${Date.now().toString(36).toUpperCase()}`,
          status: "draft" as GrnStatus,
          lines: [] as any,
          photos: [] as any,
          created_by: (context as any).user.id,
        } as any)
        .select("id, company_id, project_id")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      return {
        id: (inserted as any).id,
        company_id: (inserted as any).company_id,
        project_id: (inserted as any).project_id,
      };
    },
  );

export const saveGrnDraft = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        grnId: z.string().uuid(),
        payload: grnDraftPayload,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: existing, error: eErr } = await context.supabase
      .from("goods_receipts")
      .select("id, company_id, po_id, status")
      .eq("id", data.grnId)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!existing || (existing as any).company_id !== companyId) httpError(404, "grn_not_found");
    if ((existing as any).status !== "draft")
      httpError(409, "grn_not_draft", "Only draft GRNs can be edited.");

    const { receivable } = await receivableFor(context, (existing as any).po_id);
    const bad = overReceivedLines(data.payload.lines as GrnLine[], receivable);
    if (bad.length > 0)
      httpError(400, "over_received", `Quantity exceeds remaining on line(s) ${bad.join(", ")}.`);

    for (const p of data.payload.photos) assertGrnPhotoPath(p, companyId, data.grnId);

    const { error } = await context.supabase
      .from("goods_receipts")
      .update({
        lines: data.payload.lines as any,
        photos: data.payload.photos as any,
        notes: data.payload.notes ?? null,
      } as any)
      .eq("id", data.grnId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    return { ok: true };
  });

export const addGrnPhoto = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        grnId: z.string().uuid(),
        path: z.string().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ photos: string[] }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("goods_receipts")
      .select("id, company_id, status, photos")
      .eq("id", data.grnId)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).company_id !== companyId) httpError(404, "grn_not_found");
    if ((row as any).status !== "draft") httpError(409, "grn_not_draft");

    assertGrnPhotoPath(data.path, companyId, data.grnId);
    const current = (((row as any).photos ?? []) as string[]).filter(Boolean);
    if (current.includes(data.path)) return { photos: current };
    if (current.length >= 10) httpError(400, "photo_limit", "A GRN can hold at most 10 photos.");
    const next = [...current, data.path];
    const { error: uErr } = await context.supabase
      .from("goods_receipts")
      .update({ photos: next as any } as any)
      .eq("id", data.grnId);
    if (uErr) throw uErr;
    return { photos: next };
  });

export const removeGrnPhoto = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        grnId: z.string().uuid(),
        path: z.string().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ photos: string[] }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("goods_receipts")
      .select("id, company_id, status, photos")
      .eq("id", data.grnId)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).company_id !== companyId) httpError(404, "grn_not_found");
    if ((row as any).status !== "draft") httpError(409, "grn_not_draft");

    const current = (((row as any).photos ?? []) as string[]).filter(Boolean);
    const next = current.filter((p) => p !== data.path);
    const { error: uErr } = await context.supabase
      .from("goods_receipts")
      .update({ photos: next as any } as any)
      .eq("id", data.grnId);
    if (uErr) throw uErr;
    // Best-effort removal from storage.
    try {
      await context.supabase.storage.from("photos").remove([data.path]);
    } catch {
      /* ignore */
    }
    return { photos: next };
  });

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------
export const confirmGrn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        grnId: z.string().uuid(),
        payload: grnDraftPayload,
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: GrnStatus; grn_number: string; po_status: PoStatus }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);

      const { data: existing, error: eErr } = await context.supabase
        .from("goods_receipts")
        .select("id, company_id, po_id, project_id, status")
        .eq("id", data.grnId)
        .maybeSingle();
      if (eErr) throw eErr;
      if (!existing || (existing as any).company_id !== companyId) httpError(404, "grn_not_found");
      if ((existing as any).status !== "draft") httpError(409, "grn_not_draft");

      const { po, receivable, confirmedLines } = await receivableFor(
        context,
        (existing as any).po_id,
      );
      if (!["issued", "partially_received"].includes(po.status))
        httpError(409, "po_not_receivable");

      const lines = data.payload.lines as GrnLine[];
      const bad = overReceivedLines(lines, receivable);
      if (bad.length > 0)
        httpError(400, "over_received", `Quantity exceeds remaining on line(s) ${bad.join(", ")}.`);
      for (const p of data.payload.photos) assertGrnPhotoPath(p, companyId, data.grnId);

      const status = deriveGrnStatus(lines);
      const defects = countDefects(lines);

      // Sequence GRN number: read existing numbers for this company.
      const { data: numRows, error: nErr } = await context.supabase
        .from("goods_receipts")
        .select("grn_number")
        .eq("company_id", companyId)
        .like("grn_number", "GRN-%");
      if (nErr) throw nErr;
      let seed = ((numRows ?? []) as any[]).map((r) => r.grn_number as string);

      const now = new Date().toISOString();
      const geo = data.payload.geo ?? null;
      let saved: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const grnNumber = nextGrnNumber(seed);
        const { data: updated, error } = await context.supabase
          .from("goods_receipts")
          .update({
            grn_number: grnNumber,
            status,
            defects_count: defects,
            lines: lines as any,
            notes: data.payload.notes ?? null,
            photos: data.payload.photos as any,
            received_by: (context as any).user.id,
            received_at: now,
            receipt_lat: geo?.lat ?? null,
            receipt_lng: geo?.lng ?? null,
            receipt_accuracy_m: geo?.accuracy_m ?? null,
            receipt_geo_at: geo ? now : null,
          } as any)
          .eq("id", data.grnId)
          .eq("status", "draft")
          .select("id, grn_number, status")
          .maybeSingle();
        if (!error && updated) {
          saved = updated;
          break;
        }
        if (error && (error as any).code === "23505") {
          seed = [...seed, grnNumber];
          continue;
        }
        if (error && (error as any).code === "42501") httpError(403, "forbidden");
        if (error) throw error;
        httpError(409, "grn_not_draft");
      }
      if (!saved) httpError(409, "grn_number_conflict");

      // P-233 — lot/serial traceability rows, one per captured serial.
      const serials = serialRowsFromLines(lines);
      if (serials.length > 0) {
        await context.supabase.from("batch_serial_tracking").delete().eq("grn_id", data.grnId);
        const { error: sErr } = await context.supabase.from("batch_serial_tracking").insert(
          serials.map((s) => ({
            company_id: companyId,
            purchase_order_id: po.id,
            grn_id: data.grnId,
            grn_line_no: s.grn_line_no,
            sku: s.sku,
            batch_serial: s.batch_serial,
            qty: s.qty,
            created_by: (context as any).user.id,
          })) as any,
        );
        if (sErr && (sErr as any).code === "42501") httpError(403, "forbidden");
        if (sErr) throw sErr;
      }


      // Project PO status from all confirmed receipts + this one.
      const nextPoStatus =
        computePoStatusAfterGrn(po.lines, [...confirmedLines, ...lines]) ?? po.status;
      if (nextPoStatus !== po.status) {
        await context.supabase
          .from("purchase_orders")
          .update({ status: nextPoStatus as any } as any)
          .eq("id", po.id);
      }

      await audit(context, "grn.confirm", data.grnId, {
        po_id: po.id,
        po_number: po.po_number,
        grn_number: saved.grn_number,
        status,
        defects_count: defects,
        po_status: nextPoStatus,
      });
      if (defects > 0) {
        await audit(context, "grn.defect", data.grnId, {
          po_id: po.id,
          defects_count: defects,
          bad_lines: lines
            .filter((l) => l.condition !== "ok" || (l.defect_notes ?? "").length > 0)
            .map((l) => l.po_line_no),
        });
      }

      return {
        status: saved.status as GrnStatus,
        grn_number: saved.grn_number,
        po_status: nextPoStatus,
      };
    },
  );

// ---------------------------------------------------------------------------
// list of receivable POs (drives the "New receipt" PO picker)
// ---------------------------------------------------------------------------
export const listReceivablePos = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      Array<{ id: string; po_number: string; vendor_name: string | null; status: PoStatus }>
    > => {
      requireSupabaseAuth(context);
      const { data, error } = await context.supabase
        .from("purchase_orders")
        .select("id, po_number, status, vendors:vendor_id(name)")
        .in("status", ["issued", "partially_received"])
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        po_number: r.po_number,
        vendor_name: r.vendors?.name ?? null,
        status: r.status as PoStatus,
      }));
    },
  );
