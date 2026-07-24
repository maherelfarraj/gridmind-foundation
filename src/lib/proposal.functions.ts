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
import {
  COMPANY_BASE_CURRENCY,
  CONTINGENCY_FLOOR_PCT,
  FX_MAX_AGE_HOURS,
  MARGIN_FLOOR_PCT,
  PRICING_ENTITY,
  PRICING_RULE_KEY,
} from "@/lib/pricing-rules";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  getEsignProvider,
  isEsignConfigured,
  type EsignEvent,
} from "@/lib/esign/provider";

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
  esign_status: string | null;
  esign_provider: string | null;
  esign_envelope_id: string | null;
  esign_sent_at: string | null;
  esign_completed_at: string | null;
  esign_history: Array<{
    at: string;
    event: "sent" | "viewed" | "completed" | "declined" | "voided";
    actor: string | null;
    note?: string | null;
    provider_event_id?: string | null;
  }>;
  signed_copy_path: string | null;
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
  company_id: string;
  project_id: string | null;
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
        "id, title, version, status, currency_code, total, opportunity_id, updated_at, company_id, project_id, opportunities(name)",
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
      company_id: r.company_id,
      project_id: r.project_id ?? null,
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
      } as any)
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
          } as any)
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
          } as any);
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
      .update({ yield_result: yieldResult as any })
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


// ---------------------------------------------------------------------------
// P-046 — Pricing checklist + CFO approval gate
// ---------------------------------------------------------------------------
export interface ChecklistItem {
  key: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface ApprovalInstanceRow {
  id: string;
  status: string;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface PricingChecklistResult {
  items: ChecklistItem[];
  allPass: boolean;
  pricingLock: {
    status?: string;
    requested_by?: string;
    requested_at?: string;
    approved_by?: string;
    approved_at?: string;
    rejected_by?: string;
    rejected_at?: string;
    comment?: string;
    margin_pct?: number;
    fx_rate_snapshot?: number | null;
    contingency_pct?: number;
  } | null;
  approvalInstance: ApprovalInstanceRow | null;
}

async function computeChecklistFor(
  context: any,
  proposalId: string,
): Promise<{
  result: PricingChecklistResult;
  proposal: any;
  opportunity: any | null;
}> {
  const { supabase } = context;
  const { data: proposal, error } = await supabase
    .from("proposals")
    .select("*, opportunities(id, competitor)")
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) httpError(404, "not_found");

  const p = proposal as any;
  const opportunity = p.opportunities ?? null;

  const { data: lines, error: lErr } = await supabase
    .from("proposal_line_items")
    .select("qty, unit_price, line_total")
    .eq("proposal_id", proposalId);
  if (lErr) throw new Error(lErr.message);

  const items: ChecklistItem[] = [];
  const lineRows = lines ?? [];
  const anyBad = lineRows.some(
    (l: any) => Number(l.qty ?? 0) <= 0 || Number(l.unit_price ?? 0) < 0,
  );
  const lineSum = lineRows.reduce(
    (s: number, l: any) => s + Number(l.line_total ?? 0),
    0,
  );
  const subtotalMatch = Math.abs(lineSum - Number(p.subtotal ?? 0)) < 0.01;
  items.push({
    key: "line_items_priced",
    label: "All line items priced and totals reconcile",
    pass: lineRows.length > 0 && !anyBad && subtotalMatch,
    detail:
      lineRows.length === 0
        ? "no line items"
        : anyBad
          ? "qty or unit price invalid on one or more lines"
          : !subtotalMatch
            ? `Σ line_total (${lineSum.toFixed(2)}) ≠ subtotal (${Number(
                p.subtotal ?? 0,
              ).toFixed(2)})`
            : undefined,
  });

  const marginPass = Number(p.margin_pct ?? 0) >= MARGIN_FLOOR_PCT;
  items.push({
    key: "margin_floor",
    label: `Margin ≥ ${MARGIN_FLOOR_PCT}%`,
    pass: marginPass,
    detail: marginPass ? undefined : `current: ${Number(p.margin_pct ?? 0)}%`,
  });

  const currency = String(p.currency_code ?? "").toUpperCase();
  if (currency === COMPANY_BASE_CURRENCY) {
    items.push({
      key: "fx_snapshot",
      label: `FX (${currency} = company base)`,
      pass: true,
    });
  } else if (p.fx_rate_snapshot == null) {
    items.push({
      key: "fx_snapshot",
      label: `FX snapshot ≤ ${FX_MAX_AGE_HOURS}h old`,
      pass: false,
      detail: "no fx_rate_snapshot captured",
    });
  } else {
    const { data: fx } = await supabase
      .from("fx_rates")
      .select("as_of, rate")
      .eq("base_code", COMPANY_BASE_CURRENCY)
      .eq("quote_code", currency)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!fx) {
      items.push({
        key: "fx_snapshot",
        label: `FX snapshot ≤ ${FX_MAX_AGE_HOURS}h old`,
        pass: false,
        detail: `no FX rate available for ${COMPANY_BASE_CURRENCY}→${currency}`,
      });
    } else {
      const ageH =
        (Date.now() - new Date((fx as any).as_of).getTime()) / 3_600_000;
      items.push({
        key: "fx_snapshot",
        label: `FX snapshot ≤ ${FX_MAX_AGE_HOURS}h old`,
        pass: ageH <= FX_MAX_AGE_HOURS,
        detail:
          ageH <= FX_MAX_AGE_HOURS
            ? undefined
            : `latest rate is ${Math.round(ageH)}h old`,
      });
    }
  }

  const contPass = Number(p.contingency_pct ?? 0) >= CONTINGENCY_FLOOR_PCT;
  items.push({
    key: "contingency_floor",
    label: `Contingency ≥ ${CONTINGENCY_FLOOR_PCT}%`,
    pass: contPass,
    detail: contPass
      ? undefined
      : `current: ${Number(p.contingency_pct ?? 0)}%`,
  });

  const vu = p.valid_until ? new Date(p.valid_until) : null;
  const vuPass = !!vu && vu.getTime() > Date.now();
  items.push({
    key: "valid_until_future",
    label: "Valid-until date set and in the future",
    pass: vuPass,
    detail: !vu ? "not set" : vuPass ? undefined : "in the past",
  });

  const compPass = !!(
    opportunity?.competitor && String(opportunity.competitor).trim().length > 0
  );
  items.push({
    key: "competitor_recorded",
    label: "Competitor recorded on opportunity",
    pass: compPass,
    detail: compPass
      ? undefined
      : opportunity
        ? "no competitor on linked opportunity"
        : "proposal not linked to an opportunity",
  });

  const yr = p.yield_result ?? null;
  const yieldPass = !!yr && yr.p50_kwh != null && yr.p90_kwh != null;
  items.push({
    key: "yield_run",
    label: "Yield simulation run (P50/P90 present)",
    pass: yieldPass,
    detail: yieldPass ? undefined : "no yield result yet",
  });

  const { data: instance } = await supabase
    .from("approval_instances")
    .select("*")
    .eq("entity", PRICING_ENTITY)
    .eq("entity_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const allPass = items.every((i) => i.pass);
  return {
    result: {
      items,
      allPass,
      pricingLock: (p.pricing_lock as any) ?? null,
      approvalInstance: (instance as any) ?? null,
    },
    proposal: p,
    opportunity,
  };
}

export const getPricingChecklist = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PricingChecklistResult> => {
    requireSupabaseAuth(context);
    const { result } = await computeChecklistFor(context, data.proposalId);
    return result;
  });

export const submitPricingApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);

    const { result, proposal } = await computeChecklistFor(
      context,
      data.proposalId,
    );
    if (!result.allPass) httpError(422, "checklist_failed");

    const companyId = proposal.company_id as string;
    const opportunityId = proposal.opportunity_id as string | null;
    const now = new Date().toISOString();
    const pendingLock = {
      status: "pending",
      requested_by: context.user.id,
      requested_at: now,
      margin_pct: Number(proposal.margin_pct ?? 0),
      fx_rate_snapshot:
        proposal.fx_rate_snapshot != null
          ? Number(proposal.fx_rate_snapshot)
          : null,
      contingency_pct: Number(proposal.contingency_pct ?? 0),
    };

    let instanceId: string | null = null;
    try {
      const { data: inst, error: iErr } = await context.supabase
        .from("approval_instances")
        .insert({
          company_id: companyId,
          entity: PRICING_ENTITY,
          entity_id: data.proposalId,
          status: "pending",
          requested_by: context.user.id,
          metadata: {
            rule_key: PRICING_RULE_KEY,
            margin_pct: pendingLock.margin_pct,
            contingency_pct: pendingLock.contingency_pct,
            fx_rate_snapshot: pendingLock.fx_rate_snapshot,
            currency_code: proposal.currency_code,
            opportunity_id: opportunityId,
          },
        } as any)
        .select("id")
        .single();
      if (iErr) throw iErr;
      instanceId = (inst as any).id;

      const { data: approvers } = await context.supabase
        .from("user_roles")
        .select("user_id")
        .eq("company_id", companyId)
        .eq("role", "finance_admin");
      const rows = (approvers ?? []).map((r: any) => ({
        company_id: companyId,
        instance_id: instanceId,
        approver_id: r.user_id,
        status: "pending",
      }));
      if (rows.length > 0) {
        await context.supabase.from("approvals").insert(rows as any);
      }
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code !== "42P01" && code !== "42703") {
        // Non-schema errors — still fall through to inline lock stamp.
      }
    }

    const { error: upErr } = await context.supabase
      .from("proposals")
      .update({ pricing_lock: pendingLock as any })
      .eq("id", data.proposalId);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.pricing_submitted",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: opportunityId,
        instance_id: instanceId,
        margin_pct: pendingLock.margin_pct,
        contingency_pct: pendingLock.contingency_pct,
      },
    });

    return { ok: true, instance_id: instanceId };
  });

export const decidePricingApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        comment: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: isFinance } = await context.supabase.rpc(
      "has_company_role",
      { p_role: "finance_admin" },
    );
    if (!isFinance) httpError(403, "forbidden");

    const { data: proposal, error } = await context.supabase
      .from("proposals")
      .select(
        "id, company_id, opportunity_id, margin_pct, contingency_pct, fx_rate_snapshot, pricing_lock, status",
      )
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) httpError(404, "not_found");
    const p = proposal as any;

    const now = new Date().toISOString();
    const approved = data.decision === "approve";

    try {
      const { data: inst } = await context.supabase
        .from("approval_instances")
        .select("id")
        .eq("entity", PRICING_ENTITY)
        .eq("entity_id", data.proposalId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inst) {
        await context.supabase
          .from("approval_instances")
          .update({
            status: approved ? "approved" : "rejected",
            decided_by: context.user.id,
            decided_at: now,
          } as any)
          .eq("id", (inst as any).id);
        await context.supabase
          .from("approvals")
          .update({
            status: approved ? "approved" : "rejected",
            comment: data.comment ?? null,
            decided_at: now,
          } as any)
          .eq("instance_id", (inst as any).id)
          .eq("approver_id", context.user.id);
      }
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code !== "42P01" && code !== "42703") throw err;
    }

    const lockPayload = approved
      ? {
          status: "approved",
          approved_by: context.user.id,
          approved_at: now,
          margin_pct: Number(p.margin_pct ?? 0),
          fx_rate_snapshot:
            p.fx_rate_snapshot != null ? Number(p.fx_rate_snapshot) : null,
          contingency_pct: Number(p.contingency_pct ?? 0),
        }
      : {
          status: "rejected",
          rejected_by: context.user.id,
          rejected_at: now,
          comment: data.comment ?? null,
        };

    const patch: Record<string, any> = { pricing_lock: lockPayload };
    if (approved) patch.status = "approved";

    const { error: upErr } = await context.supabase
      .from("proposals")
      .update(patch as any)
      .eq("id", data.proposalId);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: approved
        ? "proposal.pricing_approved"
        : "proposal.pricing_rejected",
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: p.opportunity_id,
        comment: data.comment ?? null,
      },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// P-047 / P-048 — Shared export data + audit (PDF + PPTX)
// ---------------------------------------------------------------------------

export const getProposalExportData = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { supabase } = context;

    const { data: proposal, error: pErr } = await supabase
      .from("proposals")
      .select("*")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proposal) httpError(404, "not_found");
    const p = proposal as any;

    const { data: lineItems, error: liErr } = await supabase
      .from("proposal_line_items")
      .select("sort_order, category, description, qty, unit, unit_price, line_total")
      .eq("proposal_id", data.proposalId)
      .order("sort_order", { ascending: true });
    if (liErr) throw new Error(liErr.message);

    let opportunity: any = null;
    let opportunityOwnerId: string | null = null;
    if (p.opportunity_id) {
      const { data: opp } = await supabase
        .from("opportunities")
        .select("name, account_name, expected_decision_date, owner_id")
        .eq("id", p.opportunity_id)
        .maybeSingle();
      opportunity = opp
        ? {
            name: (opp as any).name,
            account_name: (opp as any).account_name,
            expected_decision_date: (opp as any).expected_decision_date,
          }
        : null;
      opportunityOwnerId = (opp as any)?.owner_id ?? null;
    }

    const companyId = p.company_id as string;
    const { data: company } = await supabase
      .from("companies")
      .select("name, legal_name, contact_email, phone, address")
      .eq("id", companyId)
      .maybeSingle();

    const { data: branding } = await supabase
      .from("company_branding")
      .select("logo_url, primary_color, accent_color, footer_text")
      .eq("company_id", companyId)
      .maybeSingle();

    let logoSignedUrl: string | null = null;
    const logoRef = (branding as any)?.logo_url as string | null | undefined;
    if (logoRef) {
      if (/^https?:\/\//i.test(logoRef)) {
        logoSignedUrl = logoRef;
      } else {
        try {
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(logoRef, 300);
          logoSignedUrl = signed?.signedUrl ?? null;
        } catch {
          logoSignedUrl = null;
        }
      }
    }

    // Sales owner — proposals.created_by preferred, fall back to opportunity owner.
    const ownerId = (p.created_by as string | null) ?? opportunityOwnerId;
    let salesOwner: { full_name: string | null; email: string | null } | null = null;
    if (ownerId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", ownerId)
        .maybeSingle();
      if (prof) {
        salesOwner = {
          full_name: (prof as any).full_name ?? null,
          email: (prof as any).email ?? null,
        };
      }
    }

    // Upcoming tender events — tolerate table absence (42P01).
    let tenderEvents: Array<{
      event_type: string;
      title: string | null;
      event_at: string;
      notes: string | null;
    }> = [];
    if (p.opportunity_id) {
      const { data: evs, error: evErr } = await supabase
        .from("tender_events")
        .select("event_type, title, event_at, notes")
        .eq("opportunity_id", p.opportunity_id)
        .gte("event_at", new Date().toISOString())
        .order("event_at", { ascending: true });
      if (evErr && (evErr as any).code !== "42P01") {
        // Non-missing-table errors: log and continue with empty list.
        // eslint-disable-next-line no-console
        console.warn("tender_events fetch failed", evErr.message);
      } else if (evs) {
        tenderEvents = (evs as any[]).map((e) => ({
          event_type: e.event_type,
          title: e.title ?? null,
          event_at: e.event_at,
          notes: e.notes ?? null,
        }));
      }
    }

    // Defence-in-depth: strip margin_pct so the client PDF/PPTX can never leak it.
    const { margin_pct: _drop, ...proposalSafe } = p;

    return {
      proposal: proposalSafe,
      lineItems: lineItems ?? [],
      opportunity,
      company: (company as any) ?? { name: "" },
      branding: {
        primaryColor: (branding as any)?.primary_color ?? null,
        accentColor: (branding as any)?.accent_color ?? null,
        footerText: (branding as any)?.footer_text ?? null,
        logoSignedUrl,
        fontFamily: "Arial" as const,
      },
      yieldResult: (p.yield_result as any) ?? null,
      salesOwner,
      tenderEvents,
    };
  });

// Back-compat alias — existing callers still import the old name.
export const getProposalPdfData = getProposalExportData;

const recordExportSchema = z.object({
  proposalId: z.string().uuid(),
  format: z.enum(["pdf", "pptx"]).default("pdf"),
});

export const recordProposalExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => recordExportSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { supabase } = context;

    const { data: proposal, error } = await supabase
      .from("proposals")
      .select("id, opportunity_id, version")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) httpError(404, "not_found");
    const p = proposal as any;

    const action =
      data.format === "pptx" ? "proposal.export_pptx" : "proposal.export_pdf";

    await supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "proposal",
      p_entity_id: data.proposalId,
      p_metadata: {
        opportunity_id: p.opportunity_id,
        version: p.version,
      },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// P-049 — E-signature: send / refresh / void / simulate / signed-copy URL
// ---------------------------------------------------------------------------


const ESIGN_EVENT = z.enum(["sent", "viewed", "completed", "declined", "voided"]);

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function envelopeStoragePath(
  companyId: string,
  proposalId: string,
  version: number,
): string {
  return `${companyId}/proposals/${proposalId}/envelope_v${version}.pdf`;
}

function signedCopyStoragePath(
  companyId: string,
  proposalId: string,
  version: number,
): string {
  return `${companyId}/proposals/${proposalId}/signed_v${version}.pdf`;
}

interface EsignHistoryEntry {
  at: string;
  event: EsignEvent;
  actor: string | null;
  provider_event_id?: string | null;
  note?: string | null;
}

/**
 * Apply a provider/user-driven envelope event to a proposal. Idempotent per
 * (envelope, event, provider_event_id). On `completed`, uploads the signed
 * PDF to documents/<company>/proposals/<id>/signed_v<version>.pdf via the
 * service-role client (privileged storage write).
 */
async function applyEsignEvent(
  supabaseUser: any,
  proposalId: string,
  event: EsignEvent,
  actor: string | null,
  providerEventId?: string | null,
): Promise<void> {
  const { data: prop, error } = await supabaseUser
    .from("proposals")
    .select(
      "id, company_id, opportunity_id, version, status, esign_status, esign_envelope_id, esign_history, signed_copy_path",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prop) httpError(404, "not_found");
  const p = prop as any;

  const history: EsignHistoryEntry[] = Array.isArray(p.esign_history)
    ? (p.esign_history as EsignHistoryEntry[])
    : [];

  if (providerEventId && history.some((h) => h.provider_event_id === providerEventId)) {
    return;
  }
  if (!providerEventId && history.length > 0) {
    const last = history[history.length - 1];
    if (last.event === event && Date.now() - new Date(last.at).getTime() < 5000) {
      return;
    }
  }

  const now = new Date().toISOString();
  const nextHistory = [
    ...history,
    { at: now, event, actor, provider_event_id: providerEventId ?? null },
  ];

  const patch: Record<string, any> = {
    esign_history: nextHistory,
    esign_status: event,
  };

  if (event === "completed") {
    const resolved = getEsignProvider();
    if (!resolved) throw new Error("esign_not_configured");
    const envelopePath = envelopeStoragePath(p.company_id, p.id, p.version ?? 1);
    const signedPath = signedCopyStoragePath(p.company_id, p.id, p.version ?? 1);
    const { createServiceRoleClient } = await import(
      "@/integrations/supabase/server"
    );
    const admin = createServiceRoleClient();
    const { bytes, contentType } = await resolved.provider.fetchSignedPdf(
      {
        envelopeId: p.esign_envelope_id ?? "",
        envelopePdfStoragePath: envelopePath,
      },
      admin,
    );
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(signedPath, bytes, {
        contentType: contentType || "application/pdf",
        upsert: true,
      });
    if (upErr) throw new Error(`signed_copy_upload_failed: ${upErr.message}`);
    patch.signed_copy_path = signedPath;
    patch.esign_completed_at = now;
    patch.status = "accepted";
    patch.accepted_at = now;
  } else if (event === "sent") {
    patch.esign_sent_at = now;
  }

  const { error: upErr } = await supabaseUser
    .from("proposals")
    .update(patch)
    .eq("id", proposalId);
  if (upErr) throw new Error(upErr.message);

  const auditAction =
    event === "completed"
      ? "proposal.esign_completed"
      : event === "declined"
        ? "proposal.esign_declined"
        : event === "voided"
          ? "proposal.esign_voided"
          : event === "viewed"
            ? "proposal.esign_viewed"
            : "proposal.esign_sent";
  await supabaseUser.rpc("write_audit_log", {
    p_action: auditAction,
    p_entity: "proposal",
    p_entity_id: proposalId,
    p_metadata: {
      opportunity_id: p.opportunity_id,
      envelope_id: p.esign_envelope_id,
      event,
    },
  });
}

// Exported for the webhook route to reuse the same state machine.
export const applyEsignEventInternal = applyEsignEvent;

export const sendProposalForSignature = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        signerName: z.string().trim().min(1).max(200),
        signerEmail: z.string().trim().email().max(320),
        pdfBase64: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const resolved = getEsignProvider();
    if (!resolved) httpError(400, "esign_not_configured");

    const { data: prop, error } = await context.supabase
      .from("proposals")
      .select(
        "id, company_id, opportunity_id, version, status, esign_status, project_id",
      )
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prop) httpError(404, "not_found");
    const p = prop as any;

    if (p.status !== "approved") httpError(422, "cfo_approval_required");
    if (p.esign_status === "sent" || p.esign_status === "viewed") {
      httpError(409, "already_out_for_signature");
    }
    if (p.esign_status === "completed") httpError(409, "already_signed");

    try {
      await assertExportAllowed(context.supabase, {
        companyId: p.company_id,
        projectId: p.project_id ?? null,
      });
    } catch (lockErr: any) {
      httpError(lockErr?.statusCode ?? 409, "export_locked");
    }

    const bytes = decodeBase64(data.pdfBase64);
    const envelopePath = envelopeStoragePath(p.company_id, p.id, p.version ?? 1);
    const { createServiceRoleClient } = await import(
      "@/integrations/supabase/server"
    );
    const admin = createServiceRoleClient();
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(envelopePath, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw new Error(`envelope_upload_failed: ${upErr.message}`);

    const sendResult = await resolved!.provider.send({
      proposalId: p.id,
      companyId: p.company_id,
      version: p.version ?? 1,
      signerName: data.signerName,
      signerEmail: data.signerEmail,
      envelopePdfStoragePath: envelopePath,
    });

    const now = new Date().toISOString();
    const history: EsignHistoryEntry[] = [
      {
        at: now,
        event: "sent",
        actor: context.user.id,
        note: `Signer: ${data.signerName} <${data.signerEmail}>`,
      },
    ];
    const { error: writeErr } = await context.supabase
      .from("proposals")
      .update({
        esign_provider: resolved!.providerName,
        esign_envelope_id: sendResult.envelopeId,
        esign_status: "sent",
        esign_sent_at: now,
        esign_history: history,
        status: "sent",
        sent_at: now,
      } as any)
      .eq("id", p.id);
    if (writeErr) throw new Error(writeErr.message);

    await context.supabase.rpc("write_audit_log", {
      p_action: "proposal.esign_sent",
      p_entity: "proposal",
      p_entity_id: p.id,
      p_metadata: {
        opportunity_id: p.opportunity_id,
        envelope_id: sendResult.envelopeId,
        signer_email: data.signerEmail,
      },
    });

    return { ok: true, envelopeId: sendResult.envelopeId };
  });

export const refreshProposalEsign = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const resolved = getEsignProvider();
    if (!resolved) httpError(400, "esign_not_configured");
    const { data: prop, error } = await context.supabase
      .from("proposals")
      .select("id, esign_envelope_id, esign_status")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prop) httpError(404, "not_found");
    const p = prop as any;
    if (!p.esign_envelope_id) return { ok: true, status: p.esign_status ?? null };
    const { status } = await resolved!.provider.refresh(p.esign_envelope_id);
    if (status && status !== p.esign_status) {
      await applyEsignEvent(context.supabase, p.id, status, context.user.id);
    }
    return { ok: true, status };
  });

export const voidProposalEsign = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: isAdmin } = await context.supabase.rpc("has_company_role", {
      p_role: "company_admin",
    });
    if (!isAdmin) httpError(403, "forbidden");
    const resolved = getEsignProvider();
    if (!resolved) httpError(400, "esign_not_configured");
    const { data: prop, error } = await context.supabase
      .from("proposals")
      .select("id, esign_envelope_id, esign_status")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prop) httpError(404, "not_found");
    const p = prop as any;
    if (!p.esign_envelope_id) httpError(409, "no_envelope");
    if (p.esign_status === "completed") httpError(409, "already_signed");
    await resolved!.provider.void(p.esign_envelope_id, data.reason);
    await applyEsignEvent(context.supabase, p.id, "voided", context.user.id);
    return { ok: true };
  });

export const simulateEsignEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        event: ESIGN_EVENT,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertProposalWriter(context);
    const resolved = getEsignProvider();
    if (!resolved || !resolved.provider.isDevMode) {
      httpError(403, "simulation_disabled");
    }
    await applyEsignEvent(
      context.supabase,
      data.proposalId,
      data.event,
      context.user.id,
    );
    return { ok: true };
  });

export const getSignedCopyDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: prop, error } = await context.supabase
      .from("proposals")
      .select("id, company_id, project_id, signed_copy_path")
      .eq("id", data.proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prop) httpError(404, "not_found");
    const p = prop as any;
    if (!p.signed_copy_path) httpError(404, "no_signed_copy");
    try {
      await assertExportAllowed(context.supabase, {
        companyId: p.company_id,
        projectId: p.project_id ?? null,
      });
    } catch (lockErr: any) {
      httpError(lockErr?.statusCode ?? 409, "export_locked");
    }
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(p.signed_copy_path, 300);
    if (sErr || !signed?.signedUrl) {
      throw new Error(sErr?.message ?? "signed_url_failed");
    }
    return { url: signed.signedUrl };
  });

export const getEsignConfigStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const resolved = getEsignProvider();
    return {
      configured: isEsignConfigured(),
      provider: resolved?.providerName ?? null,
      devMode: resolved?.provider.isDevMode ?? false,
    };
  },
);


