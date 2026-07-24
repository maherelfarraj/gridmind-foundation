// P-044 / P-045 — Proposals: versioning + builder RPCs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import {
  simulateYield,
  YIELD_ENGINE_ID,
  type ArrayConfig,
  type YieldResult,
} from "@/lib/yield/stub";

const inputSchema = z.object({ proposalId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function assertProposalWriter(context: any) {
  const [{ data: isSales }, { data: isCoAdmin }] = await Promise.all([
    context.supabase.rpc("has_company_role", { p_role: "sales" }),
    context.supabase.rpc("has_company_role", { p_role: "company_admin" }),
  ]);
  if (!isSales && !isCoAdmin) httpError(403, "forbidden");
}

async function getMyCompanyId(context: any): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.company_id) httpError(400, "no_company");
  return data.company_id as string;
}

/**
 * Create a new draft version of an existing proposal.
 *
 * Copies the source proposal + all line items, bumps `version`, links
 * `previous_version_id`, resets e-sign / lifecycle fields, and marks the
 * source row `superseded`. Writes an audit log so the opportunity timeline
 * can render the event.
 */
export const createProposalVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { supabase } = context;
    const userId = context.user.id;

    // 1. Load source proposal (RLS gates cross-company access).
    const { data: source, error: srcErr } = await supabase
      .from("proposals")
      .select("*")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!source) throw new Error("Proposal not found");

    if (source.status === "superseded" || source.status === "accepted") {
      throw new Error(
        `Cannot version a proposal in status "${source.status}"`,
      );
    }

    // 2. Load line items to copy.
    const { data: lines, error: lineErr } = await supabase
      .from("proposal_line_items")
      .select(
        "sort_order, category, description, qty, unit, unit_price, line_total",
      )
      .eq("proposal_id", source.id)
      .order("sort_order", { ascending: true });
    if (lineErr) throw new Error(lineErr.message);

    // 3. Insert new proposal row (draft, next version, chained).
    const nextVersion = (source.version ?? 1) + 1;
    const { data: created, error: insErr } = await supabase
      .from("proposals")
      .insert({
        company_id: source.company_id,
        opportunity_id: source.opportunity_id,
        project_id: source.project_id,
        title: source.title,
        version: nextVersion,
        previous_version_id: source.id,
        status: "draft",
        currency_code: source.currency_code,
        subtotal: source.subtotal,
        margin_pct: source.margin_pct,
        fx_rate_snapshot: source.fx_rate_snapshot,
        contingency_pct: source.contingency_pct,
        total: source.total,
        valid_until: source.valid_until,
        array_config: source.array_config,
        yield_result: source.yield_result,
        // pricing_lock / e-sign / lifecycle timestamps intentionally reset
        pricing_lock: null,
        esign_provider: null,
        esign_envelope_id: null,
        esign_status: null,
        esign_history: [],
        esign_sent_at: null,
        esign_completed_at: null,
        signed_copy_path: null,
        sent_at: null,
        accepted_at: null,
        notes: source.notes,
        created_by: userId,
      })
      .select("id, version")
      .single();
    if (insErr) throw new Error(insErr.message);

    // 4. Copy line items.
    if (lines && lines.length > 0) {
      const { error: copyErr } = await supabase
        .from("proposal_line_items")
        .insert(
          lines.map((l: (typeof lines)[number]) => ({
            company_id: source.company_id,
            proposal_id: created.id,
            sort_order: l.sort_order,
            category: l.category,
            description: l.description,
            qty: l.qty,
            unit: l.unit,
            unit_price: l.unit_price,
            line_total: l.line_total,
            created_by: userId,
          })),
        );
      if (copyErr) {
        // best-effort rollback of the new proposal
        await supabase.from("proposals").delete().eq("id", created.id);
        throw new Error(copyErr.message);
      }
    }

    // 5. Mark source as superseded (immutability trigger allows this — only
    //    financial fields are frozen; status is not).
    const { error: supErr } = await supabase
      .from("proposals")
      .update({ status: "superseded" })
      .eq("id", source.id);
    if (supErr) {
      await supabase.from("proposal_line_items").delete().eq("proposal_id", created.id);
      await supabase.from("proposals").delete().eq("id", created.id);
      throw new Error(supErr.message);
    }

    // 6. Audit.
    await supabase.rpc("write_audit_log", {
      p_action: "proposal.version_created",
      p_entity: "proposal",
      p_entity_id: created.id,
      p_metadata: {
        opportunity_id: source.opportunity_id,
        from_version: source.version,
        to_version: created.version,
        previous_proposal_id: source.id,
      },
    });

    return { id: created.id, version: created.version };
  });

// ---------------------------------------------------------------------------
// P-045 — Builder RPCs
// ---------------------------------------------------------------------------

// ---- getProposal -----------------------------------------------------------
export interface ProposalLineItem {
  id: string;
  sort_order: number;
  category: string | null;
  description: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
}

export interface ProposalDetail {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  opportunity_name: string | null;
  project_id: string | null;
  title: string | null;
  version: number;
  previous_version_id: string | null;
  status: string;
  currency_code: string;
  subtotal: number;
  contingency_pct: number;
  margin_pct: number;
  total: number;
  valid_until: string | null;
  notes: string | null;
  array_config: ArrayConfig | null;
  yield_result: YieldResult | null;
  created_at: string;
  updated_at: string;
  line_items: ProposalLineItem[];
}

export const getProposal = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProposalDetail | null> => {
    requireSupabaseAuth(context);
    const { supabase } = context;
    const { data: p, error } = await supabase
      .from("proposals")
      .select("*, opportunities(name)")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) return null;
    const { data: lines, error: lErr } = await supabase
      .from("proposal_line_items")
      .select("*")
      .eq("proposal_id", data.proposalId)
      .order("sort_order", { ascending: true });
    if (lErr) throw new Error(lErr.message);
    return {
      id: (p as any).id,
      company_id: (p as any).company_id,
      opportunity_id: (p as any).opportunity_id,
      opportunity_name: (p as any).opportunities?.name ?? null,
      project_id: (p as any).project_id,
      title: (p as any).title,
      version: (p as any).version,
      previous_version_id: (p as any).previous_version_id,
      status: (p as any).status,
      currency_code: (p as any).currency_code,
      subtotal: Number((p as any).subtotal ?? 0),
      contingency_pct: Number((p as any).contingency_pct ?? 0),
      margin_pct: Number((p as any).margin_pct ?? 0),
      total: Number((p as any).total ?? 0),
      valid_until: (p as any).valid_until,
      notes: (p as any).notes,
      array_config: (p as any).array_config ?? null,
      yield_result: (p as any).yield_result ?? null,
      created_at: (p as any).created_at,
      updated_at: (p as any).updated_at,
      line_items: (lines ?? []).map((l: any) => ({
        id: l.id,
        sort_order: l.sort_order ?? 0,
        category: l.category,
        description: l.description,
        qty: Number(l.qty ?? 0),
        unit: l.unit,
        unit_price: Number(l.unit_price ?? 0),
        line_total: Number(l.line_total ?? 0),
      })),
    };
  });

// ---- listProposals ---------------------------------------------------------
export interface ProposalListRow {
  id: string;
  title: string | null;
  version: number;
  status: string;
  currency_code: string;
  total: number;
  opportunity_id: string | null;
  opportunity_name: string | null;
  updated_at: string;
}

export const listProposals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ opportunityId: z.string().uuid().optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<ProposalListRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("proposals")
      .select(
        "id, title, version, status, currency_code, total, opportunity_id, updated_at, opportunities(name)",
      )
      .order("updated_at", { ascending: false });
    if (data.opportunityId) q = q.eq("opportunity_id", data.opportunityId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      version: r.version,
      status: r.status,
      currency_code: r.currency_code,
      total: Number(r.total ?? 0),
      opportunity_id: r.opportunity_id,
      opportunity_name: r.opportunities?.name ?? null,
      updated_at: r.updated_at,
    }));
  });

// ---- createProposal --------------------------------------------------------
export const createProposal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        opportunityId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        title: z.string().min(1).max(200).optional(),
        currencyCode: z.string().min(3).max(3).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const companyId = await getMyCompanyId(context);

    let title = data.title ?? "Untitled proposal";
    let projectId = data.projectId ?? null;
    if (data.opportunityId) {
      const { data: opp } = await context.supabase
        .from("opportunities")
        .select("name, project_id")
        .eq("id", data.opportunityId)
        .maybeSingle();
      if (opp) {
        title = data.title ?? `${(opp as any).name} — Proposal v1`;
        projectId = projectId ?? (opp as any).project_id ?? null;
      }
    }

    const { data: created, error } = await context.supabase
      .from("proposals")
      .insert({
        company_id: companyId,
        opportunity_id: data.opportunityId ?? null,
        project_id: projectId,
        title,
        version: 1,
        status: "draft",
        currency_code: data.currencyCode ?? "USD",
        subtotal: 0,
        margin_pct: 0,
        contingency_pct: 0,
        total: 0,
        created_by: context.user.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.created",
      p_entity: "proposal",
      p_entity_id: created.id,
      p_metadata: { opportunity_id: data.opportunityId ?? null },
    });

    return { id: created.id };
  });

// ---- saveProposalHeader ----------------------------------------------------
function recomputeTotal(
  subtotal: number,
  contingencyPct: number,
  marginPct: number,
): number {
  const withCont = subtotal * (1 + Math.max(0, contingencyPct) / 100);
  const withMargin = withCont * (1 + Math.max(0, marginPct) / 100);
  return Math.round(withMargin * 100) / 100;
}

export const saveProposalHeader = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        title: z.string().min(1).max(200),
        currency_code: z.string().min(3).max(3),
        contingency_pct: z.number().min(0).max(100),
        margin_pct: z.number().min(0).max(100),
        valid_until: z.string().nullable(),
        notes: z.string().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const { data: current, error: curErr } = await context.supabase
      .from("proposals")
      .select("subtotal, opportunity_id")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!current) httpError(404, "not_found");
    const total = recomputeTotal(
      Number((current as any).subtotal ?? 0),
      data.contingency_pct,
      data.margin_pct,
    );
    const { error } = await context.supabase
      .from("proposals")
      .update({
        title: data.title,
        currency_code: data.currency_code,
        contingency_pct: data.contingency_pct,
        margin_pct: data.margin_pct,
        valid_until: data.valid_until,
        notes: data.notes,
        total,
      })
      .eq("id", data.proposalId);
    if (error) throw new Error(error.message);
    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.updated",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: { opportunity_id: (current as any).opportunity_id ?? null },
    });
    return { ok: true, total };
  });

// ---- saveLineItems ---------------------------------------------------------
const lineItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  sort_order: z.number().int().min(0),
  category: z.string().max(80).nullable(),
  description: z.string().max(500).nullable(),
  qty: z.number().finite(),
  unit: z.string().max(20).nullable(),
  unit_price: z.number().finite(),
});

export const saveLineItems = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        items: z.array(lineItemInputSchema).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const companyId = await getMyCompanyId(context);
    const { data: proposal, error: pErr } = await context.supabase
      .from("proposals")
      .select("id, opportunity_id, contingency_pct, margin_pct, status")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proposal) httpError(404, "not_found");

    const { data: existing, error: exErr } = await context.supabase
      .from("proposal_line_items")
      .select("id")
      .eq("proposal_id", data.proposalId);
    if (exErr) throw new Error(exErr.message);

    const incomingIds = new Set(
      data.items.filter((i) => i.id).map((i) => i.id!),
    );
    const toDelete = (existing ?? [])
      .filter((r: any) => !incomingIds.has(r.id))
      .map((r: any) => r.id);
    if (toDelete.length > 0) {
      const { error } = await context.supabase
        .from("proposal_line_items")
        .delete()
        .in("id", toDelete);
      if (error) throw new Error(error.message);
    }

    let subtotal = 0;
    for (const item of data.items) {
      const line_total =
        Math.round(item.qty * item.unit_price * 100) / 100;
      subtotal += line_total;
      if (item.id) {
        const { error } = await context.supabase
          .from("proposal_line_items")
          .update({
            sort_order: item.sort_order,
            category: item.category,
            description: item.description,
            qty: item.qty,
            unit: item.unit,
            unit_price: item.unit_price,
            line_total,
          })
          .eq("id", item.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await context.supabase
          .from("proposal_line_items")
          .insert({
            company_id: companyId,
            proposal_id: data.proposalId,
            sort_order: item.sort_order,
            category: item.category,
            description: item.description,
            qty: item.qty,
            unit: item.unit,
            unit_price: item.unit_price,
            line_total,
            created_by: context.user.id,
          });
        if (error) throw new Error(error.message);
      }
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const total = recomputeTotal(
      subtotal,
      Number((proposal as any).contingency_pct ?? 0),
      Number((proposal as any).margin_pct ?? 0),
    );
    const { error: upErr } = await context.supabase
      .from("proposals")
      .update({ subtotal, total })
      .eq("id", data.proposalId);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.lines_saved",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: (proposal as any).opportunity_id ?? null,
        line_count: data.items.length,
      },
    });
    return { subtotal, total };
  });

// ---- saveArrayConfig -------------------------------------------------------
const lossesSchema = z.object({
  soiling: z.number().min(0).max(0.5),
  temperature: z.number().min(0).max(0.5),
  mismatch: z.number().min(0).max(0.5),
  wiring: z.number().min(0).max(0.5),
  inverter: z.number().min(0).max(0.5),
  availability: z.number().min(0).max(0.5),
});

const arrayConfigSchema = z.object({
  dc_capacity_kw: z.number().positive().max(10_000_000),
  ac_capacity_kw: z.number().positive().max(10_000_000),
  tilt: z.number().min(0).max(90),
  azimuth: z.number().min(0).max(360),
  gcr: z.number().min(0.1).max(1),
  tracking: z.enum(["fixed", "single_axis"]),
  latitude: z.number().min(-90).max(90),
  module_w: z.number().positive().max(2000),
  inverter: z.string().max(120),
  losses: lossesSchema,
  degradation_y1_pct: z.number().min(0).max(10),
  p90_sigma: z.number().min(0).max(0.3),
});

export const saveArrayConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        array_config: arrayConfigSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const { data: proposal } = await context.supabase
      .from("proposals")
      .select("opportunity_id")
      .eq("id", data.proposalId)
      .maybeSingle();
    const { error } = await context.supabase
      .from("proposals")
      .update({ array_config: data.array_config })
      .eq("id", data.proposalId);
    if (error) throw new Error(error.message);
    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.array_config_saved",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: (proposal as any)?.opportunity_id ?? null,
      },
    });
    return { ok: true };
  });

// ---- runYieldStub ----------------------------------------------------------
const GRACEFUL_PG_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

export const runYieldStub = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const { data: proposal, error } = await context.supabase
      .from("proposals")
      .select("array_config, opportunity_id, project_id, company_id")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) httpError(404, "not_found");
    const config = (proposal as any).array_config as ArrayConfig | null;
    if (!config) httpError(400, "array_config_missing");

    const result = simulateYield(config as ArrayConfig);
    const yieldResult: YieldResult = {
      engine: YIELD_ENGINE_ID,
      computed_at: new Date().toISOString(),
      ...result,
    };

    const { error: upErr } = await context.supabase
      .from("proposals")
      .update({ yield_result: yieldResult })
      .eq("id", data.proposalId);
    if (upErr) throw new Error(upErr.message);

    // Best-effort: upsert into project_yield_config if project linked.
    const projectId = (proposal as any).project_id as string | null;
    if (projectId) {
      try {
        const availabilityLoss = Number(config.losses.availability ?? 0);
        const losses =
          Number(config.losses.soiling ?? 0) +
          Number(config.losses.temperature ?? 0) +
          Number(config.losses.mismatch ?? 0) +
          Number(config.losses.wiring ?? 0) +
          Number(config.losses.inverter ?? 0);
        const { error: pyErr } = await context.supabase
          .from("project_yield_config")
          .upsert(
            {
              company_id: (proposal as any).company_id,
              project_id: projectId,
              p50_mwh: yieldResult.p50_kwh / 1000,
              p90_mwh: yieldResult.p90_kwh / 1000,
              losses_pct: Math.round(losses * 1000) / 10,
              degradation_pct: config.degradation_y1_pct,
              availability_pct:
                Math.round((1 - availabilityLoss) * 1000) / 10,
            },
            { onConflict: "project_id" },
          );
        if (pyErr && !GRACEFUL_PG_CODES.has((pyErr as any).code)) {
          console.warn(
            "[runYieldStub] project_yield_config upsert failed:",
            pyErr.message,
          );
        }
      } catch (err) {
        console.warn("[runYieldStub] project_yield_config skipped:", err);
      }
    }

    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.yield_simulated",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: (proposal as any).opportunity_id ?? null,
        engine: YIELD_ENGINE_ID,
        p50_kwh: yieldResult.p50_kwh,
        p90_kwh: yieldResult.p90_kwh,
      },
    });

    return yieldResult;
  });

