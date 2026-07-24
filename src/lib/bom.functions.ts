// P-057 — BOM v1 server functions.
// Thin wrappers over helpers in ./bom-helpers to keep handlers self-contained.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import {
  applyBuffer,
  BOM_CATEGORIES,
  computeBom,
  DEFAULT_BUFFERS,
  sumBomCost,
  type BomCategory,
  type BomLine,
} from "@/lib/calculators/bom";
import {
  assertBomRole,
  audit,
  BOM_RELEASE_ROLES,
  BOM_WRITE_ROLES,
  bomHttpError,
  isBomCategory,
  loadBomProject,
  loadSnapshotWithProject,
  projectIdInput,
  snapshotIdInput,
  updateLineInput,
} from "@/lib/bom-helpers";

// ---------------------------------------------------------------------------
// Types shared with the client
// ---------------------------------------------------------------------------
export interface BomSnapshotRow {
  id: string;
  project_id: string;
  company_id: string;
  version: number;
  status: "draft" | "released" | "superseded";
  params: Record<string, any>;
  totals: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface BomLineRow {
  id: string;
  snapshot_id: string;
  company_id: string;
  category: BomCategory;
  item: string;
  spec: string | null;
  unit: string;
  qty: number;
  buffer_pct: number;
  qty_buffered: number;
  unit_cost: number | null;
  notes: string | null;
  updated_at: string;
}

export interface BomSnapshotDetail {
  snapshot: BomSnapshotRow;
  lines: BomLineRow[];
}

// ---------------------------------------------------------------------------
// list snapshots
// ---------------------------------------------------------------------------
export const listBomSnapshots = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<BomSnapshotRow[]> => {
    requireSupabaseAuth(context);
    const project = await loadBomProject(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("bom_snapshots")
      .select(
        "id, project_id, company_id, version, status, params, totals, created_at, updated_at",
      )
      .eq("project_id", project.id)
      .order("version", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as any;
  });

// ---------------------------------------------------------------------------
// get one snapshot + lines
// ---------------------------------------------------------------------------
export const getBomSnapshot = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => snapshotIdInput.parse(input))
  .handler(async ({ data, context }): Promise<BomSnapshotDetail> => {
    requireSupabaseAuth(context);
    const snap = await loadSnapshotWithProject(context, data.snapshotId);
    const { data: full, error: sErr } = await context.supabase
      .from("bom_snapshots")
      .select(
        "id, project_id, company_id, version, status, params, totals, created_at, updated_at",
      )
      .eq("id", snap.id)
      .maybeSingle();
    if (sErr) throw sErr;
    const { data: lines, error: lErr } = await context.supabase
      .from("bom_lines")
      .select(
        "id, snapshot_id, company_id, category, item, spec, unit, qty, buffer_pct, qty_buffered, unit_cost, notes, updated_at",
      )
      .eq("snapshot_id", snap.id)
      .order("category", { ascending: true })
      .order("item", { ascending: true });
    if (lErr) throw lErr;
    return { snapshot: full as any, lines: (lines ?? []) as any };
  });

// ---------------------------------------------------------------------------
// generate — reads archetype config, writes snapshot + lines
// ---------------------------------------------------------------------------
export const generateBom = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadBomProject(context, data.projectId);
    await assertBomRole(context, project.company_id, BOM_WRITE_ROLES);

    // Load PV config (may be absent).
    const { data: pv, error: pvErr } = await context.supabase
      .from("project_pv_config")
      .select(
        "module_type, tracker_type, tilt_deg, gcr, dc_ac_ratio, dc_capacity_mwp, inverter_count, updated_at",
      )
      .eq("project_id", project.id)
      .maybeSingle();
    if (pvErr) throw pvErr;

    const capacityMwp =
      pv?.dc_capacity_mwp != null
        ? Number(pv.dc_capacity_mwp)
        : project.capacity_mw != null
          ? Number(project.capacity_mw)
          : 0;
    if (!(capacityMwp > 0)) {
      bomHttpError(
        400,
        "missing_capacity",
        "Set the project's DC capacity (MWp) or fill the PV archetype config before generating a BOM.",
      );
    }

    // Extract module Wp from module_type (e.g. "550 Wp bifacial") when present.
    let moduleWp: number | undefined;
    if (pv?.module_type) {
      const m = String(pv.module_type).match(/(\d{3,4})\s*Wp?/i);
      if (m) moduleWp = Number(m[1]);
    }

    const params = {
      capacity_mwp_dc: capacityMwp,
      module_wp: moduleWp,
      dc_ac_ratio: pv?.dc_ac_ratio != null ? Number(pv.dc_ac_ratio) : undefined,
      inverter_count:
        pv?.inverter_count != null ? Number(pv.inverter_count) : undefined,
      tracker_type: (pv?.tracker_type as any) ?? undefined,
    };
    const computed = computeBom(params);
    const total = sumBomCost(computed);

    // Determine next version.
    const { data: prev, error: vErr } = await context.supabase
      .from("bom_snapshots")
      .select("version")
      .eq("project_id", project.id)
      .order("version", { ascending: false })
      .limit(1);
    if (vErr) throw vErr;
    const nextVersion = ((prev?.[0] as any)?.version ?? 0) + 1;

    const totals = {
      line_count: computed.length,
      total_cost: total,
      generated_from: {
        pv_config_updated_at: pv?.updated_at ?? null,
        capacity_mwp_dc: capacityMwp,
      },
    };

    const { data: snap, error: iErr } = await context.supabase
      .from("bom_snapshots")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        version: nextVersion,
        status: "draft",
        params: params as any,
        totals: totals as any,
        created_by: (context as any).user?.id ?? null,
      })
      .select("id")
      .single();
    if (iErr) throw iErr;

    const linesPayload = computed.map((l: BomLine) => ({
      company_id: project.company_id,
      snapshot_id: snap!.id,
      category: l.category,
      item: l.item,
      spec: l.spec ?? null,
      unit: l.unit,
      qty: l.qty,
      buffer_pct: l.buffer_pct,
      qty_buffered: l.qty_buffered,
      unit_cost: l.unit_cost ?? null,
      notes: l.notes ?? null,
    }));

    const { error: lErr } = await context.supabase
      .from("bom_lines")
      .insert(linesPayload as any);
    if (lErr) throw lErr;

    await audit(
      context,
      "engineering.bom_generated",
      "bom_snapshots",
      snap!.id,
      {
        project_id: project.id,
        version: nextVersion,
        line_count: computed.length,
        params,
      },
    );

    return { ok: true, snapshotId: snap!.id, version: nextVersion };
  });

// ---------------------------------------------------------------------------
// update line (qty / buffer / unit_cost / notes)
// ---------------------------------------------------------------------------
export const updateBomLine = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateLineInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { data: line, error: fErr } = await context.supabase
      .from("bom_lines")
      .select("id, snapshot_id, company_id, category, qty, buffer_pct, unit_cost")
      .eq("id", data.lineId)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!line) bomHttpError(404, "line_not_found");

    await assertBomRole(context, (line as any).company_id, BOM_WRITE_ROLES);

    const snap = await loadSnapshotWithProject(
      context,
      (line as any).snapshot_id,
    );
    if (snap.status === "released" || snap.status === "superseded") {
      bomHttpError(409, "snapshot_locked", "Released BOM lines are read-only.");
    }

    const nextQty = data.qty ?? Number((line as any).qty);
    const nextBuffer =
      data.buffer_pct ?? Number((line as any).buffer_pct);
    const category = isBomCategory((line as any).category)
      ? ((line as any).category as BomCategory)
      : "other";
    const nextBuffered = applyBuffer(nextQty, nextBuffer, category);

    const patch: Record<string, any> = {
      qty: nextQty,
      buffer_pct: nextBuffer,
      qty_buffered: nextBuffered,
    };
    if (data.unit_cost !== undefined) patch.unit_cost = data.unit_cost;
    if (data.notes !== undefined) patch.notes = data.notes;

    const { error: uErr } = await context.supabase
      .from("bom_lines")
      .update(patch as any)
      .eq("id", data.lineId);

      .eq("id", data.lineId);
    if (uErr) throw uErr;

    // Refresh snapshot totals.
    const { data: siblingLines } = await context.supabase
      .from("bom_lines")
      .select("qty_buffered, unit_cost")
      .eq("snapshot_id", snap.id);
    const total = sumBomCost((siblingLines ?? []) as any);
    await context.supabase
      .from("bom_snapshots")
      .update({
        totals: {
          line_count: (siblingLines ?? []).length,
          total_cost: total,
        } as any,
      })
      .eq("id", snap.id);

    return { ok: true, qty_buffered: nextBuffered, total_cost: total };
  });

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------
export const releaseBom = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => snapshotIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const snap = await loadSnapshotWithProject(context, data.snapshotId);
    await assertBomRole(context, snap.company_id, BOM_RELEASE_ROLES);

    if (snap.status === "released") {
      bomHttpError(409, "already_released");
    }
    if (snap.status === "superseded") {
      bomHttpError(409, "cannot_release_superseded");
    }

    // Mark prior released versions superseded.
    const { error: sErr } = await context.supabase
      .from("bom_snapshots")
      .update({ status: "superseded" })
      .eq("project_id", snap.project_id)
      .eq("status", "released");
    if (sErr) throw sErr;

    const { error: rErr } = await context.supabase
      .from("bom_snapshots")
      .update({ status: "released" })
      .eq("id", snap.id);
    if (rErr) throw rErr;

    await audit(
      context,
      "engineering.bom_released",
      "bom_snapshots",
      snap.id,
      {
        project_id: snap.project_id,
        version: snap.version,
      },
    );

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// role probe
// ---------------------------------------------------------------------------
export const getMyBomRoles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ canWrite: boolean; canRelease: boolean }> => {
      requireSupabaseAuth(context);
      const project = await loadBomProject(context, data.projectId);
      const { data: rows, error } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("company_id", project.company_id);
      if (error) throw error;
      const roles = new Set((rows ?? []).map((r: any) => r.role));
      const canWrite = BOM_WRITE_ROLES.some((r) => roles.has(r));
      const canRelease = BOM_RELEASE_ROLES.some((r) => roles.has(r));
      return { canWrite, canRelease };
    },
  );

// ---------------------------------------------------------------------------
// KPI hook for procurement Batch 07
// ---------------------------------------------------------------------------
export const getBomKpi = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      snapshotCount: number;
      releasedVersion: number | null;
      releasedTotalCost: number | null;
    }> => {
      requireSupabaseAuth(context);
      const project = await loadBomProject(context, data.projectId);
      const { data: rows, error } = await context.supabase
        .from("bom_snapshots")
        .select("version, status, totals")
        .eq("project_id", project.id);
      if (error) throw error;
      const list = (rows ?? []) as Array<any>;
      const released = list.find((r) => r.status === "released");
      return {
        snapshotCount: list.length,
        releasedVersion: released?.version ?? null,
        releasedTotalCost:
          released?.totals?.total_cost != null
            ? Number(released.totals.total_cost)
            : null,
      };
    },
  );

// keep zod import used for tree-shakeable side effects
void z;
export { BOM_CATEGORIES };
