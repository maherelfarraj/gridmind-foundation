// P-069 — Vendor scorecard server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  computeOtdPct,
  computeQuality,
  computeResponsiveness,
  listSchema,
  recomputeSchema,
  RECOMPUTE_ROLES,
  type ExpeditingInput,
  type GrnInput,
} from "@/lib/scorecard-rules";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
export interface ScorecardRow {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  project_id: string | null;
  project_name: string | null;
  period_start: string;
  period_end: string;
  on_time_delivery_pct: number | null;
  quality_score: number | null;
  responsiveness_score: number | null;
  total_pos: number;
  total_receipts: number;
  defects_count: number;
  computed_at: string | null;
}

export interface ScorecardListResult {
  current: ScorecardRow[];
  prior: ScorecardRow[];
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
  const cid = (data as any)?.company_id;
  if (!cid) httpError(400, "no_company");
  return cid as string;
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function audit(context: AuthContext, action: string, metadata: Record<string, unknown>) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "vendor_scorecards",
      p_entity_id: null as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toRow(r: any): ScorecardRow {
  return {
    id: r.id,
    vendor_id: r.vendor_id,
    vendor_name: r.vendors?.name ?? null,
    project_id: r.project_id ?? null,
    project_name: r.projects?.name ?? null,
    period_start: r.period_start,
    period_end: r.period_end,
    on_time_delivery_pct: r.on_time_delivery_pct == null ? null : Number(r.on_time_delivery_pct),
    quality_score: r.quality_score == null ? null : Number(r.quality_score),
    responsiveness_score: r.responsiveness_score == null ? null : Number(r.responsiveness_score),
    total_pos: r.total_pos ?? 0,
    total_receipts: r.total_receipts ?? 0,
    defects_count: r.defects_count ?? 0,
    computed_at: r.computed_at ?? null,
  };
}

function priorPeriod(
  periodStart: string,
  periodEnd: string,
): {
  start: string;
  end: string;
} {
  const s = new Date(periodStart + "T00:00:00Z");
  const e = new Date(periodEnd + "T00:00:00Z");
  const days = Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1;
  const priorEnd = new Date(s.getTime() - 24 * 3600 * 1000);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 24 * 3600 * 1000);
  return {
    start: priorStart.toISOString().slice(0, 10),
    end: priorEnd.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getScorecardAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canRecompute: boolean }> => {
    requireSupabaseAuth(context);
    return { canRecompute: await hasAnyRole(context, RECOMPUTE_ROLES) };
  });

// ---------------------------------------------------------------------------
// list (current + prior period)
// ---------------------------------------------------------------------------
export const listScorecards = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScorecardListResult> => {
    requireSupabaseAuth(context);
    const prior = priorPeriod(data.periodStart, data.periodEnd);
    const sel = "*, vendors:vendor_id(name), projects:project_id(name)";

    const [cur, prev] = await Promise.all([
      context.supabase
        .from("vendor_scorecards")
        .select(sel)
        .eq("period_start", data.periodStart)
        .eq("period_end", data.periodEnd),
      context.supabase
        .from("vendor_scorecards")
        .select(sel)
        .eq("period_start", prior.start)
        .eq("period_end", prior.end),
    ]);
    if (cur.error) throw cur.error;
    if (prev.error) throw prev.error;
    return {
      current: ((cur.data ?? []) as any[]).map(toRow),
      prior: ((prev.data ?? []) as any[]).map(toRow),
    };
  });

// ---------------------------------------------------------------------------
// vendor history + contributing records
// ---------------------------------------------------------------------------
export const getVendorHistory = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        vendorId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      history: ScorecardRow[];
      grns: Array<{
        id: string;
        grn_number: string;
        po_number: string | null;
        received_at: string | null;
        required_by_date: string | null;
        defects_count: number;
        status: string;
        on_time: boolean | null;
      }>;
      pos: Array<{
        id: string;
        po_number: string;
        required_by_date: string | null;
        status: string;
      }>;
    }> => {
      requireSupabaseAuth(context);
      const { data: history, error: hErr } = await context.supabase
        .from("vendor_scorecards")
        .select("*, vendors:vendor_id(name), projects:project_id(name)")
        .eq("vendor_id", data.vendorId)
        .order("period_start", { ascending: true });
      if (hErr) throw hErr;

      const { data: pos, error: pErr } = await context.supabase
        .from("purchase_orders")
        .select("id, po_number, required_by_date, status, issued_at")
        .eq("vendor_id", data.vendorId)
        .gte("issued_at", `${data.periodStart}T00:00:00Z`)
        .lte("issued_at", `${data.periodEnd}T23:59:59Z`)
        .order("issued_at", { ascending: false });
      if (pErr) throw pErr;
      const poIds = ((pos ?? []) as any[]).map((p) => p.id);
      const dueMap: Record<string, string | null> = {};
      for (const p of (pos ?? []) as any[]) dueMap[p.id] = p.required_by_date;

      let grnRows: any[] = [];
      if (poIds.length > 0) {
        const { data: grns, error: gErr } = await context.supabase
          .from("goods_receipts")
          .select(
            "id, grn_number, po_id, received_at, defects_count, status, purchase_orders:po_id(po_number)",
          )
          .in("po_id", poIds)
          .in("status", ["confirmed", "has_defects", "closed"])
          .not("received_at", "is", null)
          .gte("received_at", `${data.periodStart}T00:00:00Z`)
          .lte("received_at", `${data.periodEnd}T23:59:59Z`)
          .order("received_at", { ascending: false });
        if (gErr) throw gErr;
        grnRows = (grns ?? []) as any[];
      }

      return {
        history: ((history ?? []) as any[]).map(toRow),
        grns: grnRows.map((g) => {
          const due = dueMap[g.po_id] ?? null;
          const rec = g.received_at ? String(g.received_at).slice(0, 10) : null;
          return {
            id: g.id,
            grn_number: g.grn_number,
            po_number: g.purchase_orders?.po_number ?? null,
            received_at: g.received_at,
            required_by_date: due,
            defects_count: g.defects_count ?? 0,
            status: g.status,
            on_time: due && rec ? rec <= due : null,
          };
        }),
        pos: ((pos ?? []) as any[]).map((p) => ({
          id: p.id,
          po_number: p.po_number,
          required_by_date: p.required_by_date,
          status: p.status,
        })),
      };
    },
  );

// ---------------------------------------------------------------------------
// recompute
// ---------------------------------------------------------------------------
export const recomputeScorecards = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => recomputeSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ upsertedCount: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, RECOMPUTE_ROLES))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);

    const startTs = `${data.periodStart}T00:00:00Z`;
    const endTs = `${data.periodEnd}T23:59:59Z`;

    // POs issued in period (optional project filter).
    let poQ = context.supabase
      .from("purchase_orders")
      .select("id, vendor_id, project_id, required_by_date, issued_at")
      .eq("company_id", companyId)
      .gte("issued_at", startTs)
      .lte("issued_at", endTs)
      .not("vendor_id", "is", null);
    if (data.projectId) poQ = poQ.eq("project_id", data.projectId);
    const { data: pos, error: poErr } = await poQ;
    if (poErr) throw poErr;
    const poRows = (pos ?? []) as any[];
    if (poRows.length === 0) {
      await audit(context, "scorecard.recompute", {
        period: { start: data.periodStart, end: data.periodEnd },
        project_id: data.projectId ?? null,
        vendor_count: 0,
      });
      return { upsertedCount: 0 };
    }

    const poIds = poRows.map((p) => p.id);
    const poVendor: Record<string, string> = {};
    const poDue: Record<string, string | null> = {};
    for (const p of poRows) {
      poVendor[p.id] = p.vendor_id;
      poDue[p.id] = p.required_by_date;
    }

    // GRNs in period.
    const { data: grns, error: gErr } = await context.supabase
      .from("goods_receipts")
      .select("id, po_id, status, defects_count, received_at")
      .in("po_id", poIds)
      .in("status", ["confirmed", "has_defects", "closed"])
      .not("received_at", "is", null)
      .gte("received_at", startTs)
      .lte("received_at", endTs);
    if (gErr) throw gErr;

    // Expediting logs in period.
    const { data: exp, error: eErr } = await context.supabase
      .from("expediting_logs")
      .select("po_id, status, last_vendor_contact_at")
      .in("po_id", poIds);
    if (eErr) throw eErr;

    // Group by vendor.
    const byVendor: Record<
      string,
      {
        pos: Set<string>;
        grns: GrnInput[];
        exp: ExpeditingInput[];
        defects: number;
      }
    > = {};
    for (const p of poRows) {
      const v = p.vendor_id as string;
      (byVendor[v] ??= { pos: new Set(), grns: [], exp: [], defects: 0 }).pos.add(p.id);
    }
    for (const g of (grns ?? []) as any[]) {
      const v = poVendor[g.po_id];
      if (!v) continue;
      const b = byVendor[v];
      if (!b) continue;
      b.grns.push({
        po_id: g.po_id,
        status: g.status,
        defects_count: g.defects_count ?? 0,
        received_at: g.received_at,
      });
      b.defects += g.defects_count ?? 0;
    }
    for (const l of (exp ?? []) as any[]) {
      const v = poVendor[l.po_id];
      if (!v) continue;
      const b = byVendor[v];
      if (!b) continue;
      b.exp.push({
        status: l.status,
        last_vendor_contact_at: l.last_vendor_contact_at,
      });
    }

    const nowIso = new Date().toISOString();
    const upserts = Object.entries(byVendor).map(([vendorId, b]) => ({
      company_id: companyId,
      vendor_id: vendorId,
      project_id: data.projectId ?? null,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      on_time_delivery_pct: computeOtdPct(b.grns, poDue),
      quality_score: computeQuality(b.grns),
      responsiveness_score: computeResponsiveness(b.exp),
      total_pos: b.pos.size,
      total_receipts: b.grns.length,
      defects_count: b.defects,
      computed_at: nowIso,
    }));

    if (upserts.length > 0) {
      const { error: uErr } = await context.supabase
        .from("vendor_scorecards")
        .upsert(upserts as any, {
          onConflict: "vendor_id,project_id,period_start,period_end",
        });
      if (uErr) {
        if ((uErr as any).code === "42501") httpError(403, "forbidden");
        throw uErr;
      }
    }

    await audit(context, "scorecard.recompute", {
      period: { start: data.periodStart, end: data.periodEnd },
      project_id: data.projectId ?? null,
      vendor_count: upserts.length,
    });

    return { upsertedCount: upserts.length };
  });
