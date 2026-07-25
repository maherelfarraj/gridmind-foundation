// P-042 — CRM server functions: opportunities, leads, KPIs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { toCsv } from "@/lib/csv";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const OPPORTUNITY_STAGES = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 60,
  negotiation: 80,
  won: 100,
  lost: 0,
};

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospecting: "Prospecting",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

const ARCHETYPES = [
  "utility_pv",
  "standalone_bess",
  "c_and_i_rooftop",
  "onshore_wind",
  "hybrid_pv_bess",
  "transmission_substation",
  "green_hydrogen",
] as const;

const LEAD_STATUSES = [
  "new",
  "working",
  "qualified",
  "unqualified",
  "converted",
] as const;

const LEAD_SOURCES = [
  "referral",
  "inbound",
  "outbound",
  "event",
  "partner",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function assertCrmWriter(context: any) {
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

async function resolveOwnerMap(context: any, ids: (string | null)[]) {
  const uniq = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (uniq.length === 0) return {} as Record<string, { full_name: string | null; email: string | null; avatar_url: string | null }>;
  const { data } = await context.supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", uniq);
  const map: Record<string, any> = {};
  for (const p of (data ?? []) as any[]) map[p.id] = p;
  return map;
}

// ---------------------------------------------------------------------------
// Types (returned to client)
// ---------------------------------------------------------------------------
export interface OpportunityRow {
  id: string;
  name: string;
  account_name: string | null;
  archetype: (typeof ARCHETYPES)[number] | null;
  capacity_mw: number | null;
  estimated_value: number | null;
  currency_code: string;
  expected_decision_date: string | null;
  stage: OpportunityStage;
  probability: number | null;
  loss_reason: string | null;
  lead_id: string | null;
  owner_id: string | null;
  owner: { full_name: string | null; email: string | null; avatar_url: string | null } | null;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  lost_at: string | null;
}

export interface LeadRow {
  id: string;
  name: string;
  account_name: string | null;
  email: string | null;
  phone: string | null;
  source: (typeof LEAD_SOURCES)[number];
  status: (typeof LEAD_STATUSES)[number];
  owner_id: string | null;
  owner: { full_name: string | null; email: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface CrmKpis {
  winRate: number | null;
  proposalCycleDays: number | null;
  avgDealSize: number | null;
  avgDealCurrency: string;
  pipelineCoverage: number | null;
}

// ---------------------------------------------------------------------------
// listOpportunities
// ---------------------------------------------------------------------------
const listOppsInput = z.object({
  search: z.string().max(200).optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  archetype: z.enum(ARCHETYPES).optional(),
  ownerId: z.string().uuid().optional(),
});

export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listOppsInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<OpportunityRow[]> => {
    requireSupabaseAuth(context);

    let q = context.supabase
      .from("opportunities")
      .select(
        "id, name, account_name, archetype, capacity_mw, estimated_value, currency_code, expected_decision_date, stage, probability, loss_reason, lead_id, owner_id, created_at, updated_at, won_at, lost_at",
      )
      .order("updated_at", { ascending: false })
      .limit(500);

    if (data.stage) q = q.eq("stage", data.stage);
    if (data.archetype) q = q.eq("archetype", data.archetype);
    if (data.ownerId) q = q.eq("owner_id", data.ownerId);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      if (s) q = q.or(`name.ilike.%${s}%,account_name.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const ownerMap = await resolveOwnerMap(context, (rows ?? []).map((r: any) => r.owner_id));
    return (rows ?? []).map((r: any) => ({
      ...r,
      owner: r.owner_id ? ownerMap[r.owner_id] ?? null : null,
    }));
  });

// ---------------------------------------------------------------------------
// createOpportunity
// ---------------------------------------------------------------------------
const createOppInput = z.object({
  name: z.string().trim().min(1).max(200),
  account_name: z.string().trim().max(200).optional().nullable(),
  archetype: z.enum(ARCHETYPES).optional().nullable(),
  capacity_mw: z.number().nonnegative().optional().nullable(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  currency_code: z.string().trim().length(3).default("USD"),
  expected_decision_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export const createOpportunity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createOppInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);
    const companyId = await getMyCompanyId(context);

    const { data: row, error } = await context.supabase
      .from("opportunities")
      .insert({
        company_id: companyId,
        name: data.name,
        account_name: data.account_name ?? null,
        archetype: data.archetype ?? null,
        capacity_mw: data.capacity_mw ?? null,
        estimated_value: data.estimated_value ?? null,
        currency_code: (data.currency_code ?? "USD").toUpperCase(),
        expected_decision_date: data.expected_decision_date ?? null,
        stage: "prospecting" as OpportunityStage,
        probability: STAGE_PROBABILITY.prospecting,
        created_by: context.user.id,
        owner_id: context.user.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    await context.supabase.rpc("write_audit_log", {
      p_action: "opportunity.created",
      p_entity: "opportunities",
      p_entity_id: row.id,
      p_metadata: { opportunity_id: row.id, name: data.name },
    });
    return { id: row.id as string };
  });

// ---------------------------------------------------------------------------
// moveOpportunityStage
// ---------------------------------------------------------------------------
const moveInput = z
  .object({
    id: z.string().uuid(),
    stage: z.enum(OPPORTUNITY_STAGES),
    lossReason: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.stage === "lost" && (!val.lossReason || val.lossReason.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lossReason"],
        message: "A loss reason (min 3 characters) is required when moving to Lost.",
      });
    }
  });

export const moveOpportunityStage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => moveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    const { data: existing, error: exErr } = await context.supabase
      .from("opportunities")
      .select("id, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "opportunity_not_found");

    const nowIso = new Date().toISOString();

    const { error } = await context.supabase
      .from("opportunities")
      .update({
        stage: data.stage,
        probability: STAGE_PROBABILITY[data.stage],
        won_at: data.stage === "won" ? nowIso : null,
        lost_at: data.stage === "lost" ? nowIso : null,
        loss_reason: data.stage === "lost" ? (data.lossReason ?? null) : null,
      })
      .eq("id", data.id);
    if (error) throw error;

    await context.supabase.rpc("write_audit_log", {
      p_action: "opportunity.stage_changed",
      p_entity: "opportunities",
      p_entity_id: data.id,
      p_metadata: {
        opportunity_id: data.id,
        from: existing.stage,
        to: data.stage,
        loss_reason: data.stage === "lost" ? data.lossReason ?? null : null,
      },
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// exportOpportunitiesCsv
// ---------------------------------------------------------------------------
export const exportOpportunitiesCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listOppsInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await getMyCompanyId(context);
    await assertExportAllowed(context.supabase, null, "csv");

    let q = context.supabase
      .from("opportunities")
      .select(
        "id, name, account_name, archetype, capacity_mw, estimated_value, currency_code, expected_decision_date, stage, probability, owner_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5000);
    if (data.stage) q = q.eq("stage", data.stage);
    if (data.archetype) q = q.eq("archetype", data.archetype);
    if (data.ownerId) q = q.eq("owner_id", data.ownerId);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      if (s) q = q.or(`name.ilike.%${s}%,account_name.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const ownerMap = await resolveOwnerMap(context, (rows ?? []).map((r: any) => r.owner_id));
    const headers = [
      "id",
      "name",
      "account_name",
      "archetype",
      "capacity_mw",
      "estimated_value",
      "currency_code",
      "expected_decision_date",
      "stage",
      "probability",
      "owner",
      "created_at",
    ];
    const csv = toCsv(
      headers,
      (rows ?? []).map((r: any) => [
        r.id,
        r.name,
        r.account_name ?? "",
        r.archetype ?? "",
        r.capacity_mw ?? "",
        r.estimated_value ?? "",
        r.currency_code ?? "",
        r.expected_decision_date ?? "",
        r.stage,
        r.probability ?? "",
        r.owner_id
          ? ownerMap[r.owner_id]?.full_name ?? ownerMap[r.owner_id]?.email ?? ""
          : "",
        r.created_at,
      ]),
    );
    const filename = `opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    return { csv, filename };
  });

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
const listLeadsInput = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

export const listLeads = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listLeadsInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<LeadRow[]> => {
    requireSupabaseAuth(context);

    let q = context.supabase
      .from("leads")
      .select(
        "id, name, account_name, email, phone, source, status, owner_id, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      if (s) q = q.or(`name.ilike.%${s}%,account_name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;

    const ownerMap = await resolveOwnerMap(context, (rows ?? []).map((r: any) => r.owner_id));
    return (rows ?? []).map((r: any) => ({
      ...r,
      owner: r.owner_id
        ? { full_name: ownerMap[r.owner_id]?.full_name ?? null, email: ownerMap[r.owner_id]?.email ?? null }
        : null,
    }));
  });

const createLeadInput = z.object({
  name: z.string().trim().min(1).max(200),
  account_name: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  source: z.enum(LEAD_SOURCES).default("inbound"),
});

export const createLead = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createLeadInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);
    const companyId = await getMyCompanyId(context);

    const { data: row, error } = await context.supabase
      .from("leads")
      .insert({
        company_id: companyId,
        name: data.name,
        account_name: data.account_name ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        source: data.source,
        status: "new",
        created_by: context.user.id,
        owner_id: context.user.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    await context.supabase.rpc("write_audit_log", {
      p_action: "lead.created",
      p_entity: "leads",
      p_entity_id: row.id,
      p_metadata: { lead_id: row.id, name: data.name },
    });
    return { id: row.id as string };
  });

const convertInput = z.object({ leadId: z.string().uuid() });

export const convertLead = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => convertInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);
    const companyId = await getMyCompanyId(context);

    const { data: lead, error: lErr } = await context.supabase
      .from("leads")
      .select("id, name, account_name, status")
      .eq("id", data.leadId)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!lead) httpError(404, "lead_not_found");
    if (lead.status === "converted") httpError(409, "already_converted");

    const { data: opp, error: oErr } = await context.supabase
      .from("opportunities")
      .insert({
        company_id: companyId,
        name: lead.name,
        account_name: lead.account_name,
        lead_id: lead.id,
        stage: "qualification" as OpportunityStage,
        probability: STAGE_PROBABILITY.qualification,
        currency_code: "USD",
        created_by: context.user.id,
        owner_id: context.user.id,
      })
      .select("id")
      .single();
    if (oErr) throw oErr;

    const { error: upErr } = await context.supabase
      .from("leads")
      .update({ status: "converted" })
      .eq("id", lead.id);
    if (upErr) throw upErr;

    await context.supabase.rpc("write_audit_log", {
      p_action: "opportunity.created",
      p_entity: "opportunities",
      p_entity_id: opp.id,
      p_metadata: { opportunity_id: opp.id, lead_id: lead.id, source: "lead_conversion" },
    });
    await context.supabase.rpc("write_audit_log", {
      p_action: "lead.converted",
      p_entity: "leads",
      p_entity_id: lead.id,
      p_metadata: { opportunity_id: opp.id, lead_id: lead.id },
    });
    return { opportunityId: opp.id as string };
  });

// ---------------------------------------------------------------------------
// getCrmKpis
// ---------------------------------------------------------------------------
export const getCrmKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<CrmKpis> => {
    requireSupabaseAuth(context);

    const twelveMoAgo = new Date();
    twelveMoAgo.setMonth(twelveMoAgo.getMonth() - 12);
    const cutoff = twelveMoAgo.toISOString();

    // Fetch trailing 12 mo wons + losts (small, RLS-scoped).
    const { data: closedRows, error: closedErr } = await context.supabase
      .from("opportunities")
      .select("stage, estimated_value, won_at, lost_at, currency_code")
      .in("stage", ["won", "lost"])
      .or(`won_at.gte.${cutoff},lost_at.gte.${cutoff}`);
    if (closedErr) throw closedErr;

    const wons = (closedRows ?? []).filter((r: any) => r.stage === "won");
    const losts = (closedRows ?? []).filter((r: any) => r.stage === "lost");
    const winDenom = wons.length + losts.length;
    const winRate = winDenom > 0 ? wons.length / winDenom : null;

    const wonValues = wons
      .map((r: any) => Number(r.estimated_value ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avgDealSize =
      wonValues.length > 0
        ? wonValues.reduce((a, b) => a + b, 0) / wonValues.length
        : null;
    const avgDealCurrency = (wons[0] as any)?.currency_code ?? "USD";

    // Pipeline coverage: sum(open value * prob/100) / max(avg monthly won * 3, 1).
    const { data: openRows, error: openErr } = await context.supabase
      .from("opportunities")
      .select("estimated_value, probability")
      .not("stage", "in", "(won,lost)");
    if (openErr) throw openErr;
    const weightedPipeline = (openRows ?? []).reduce((sum: number, r: any) => {
      const val = Number(r.estimated_value ?? 0);
      const p = Number(r.probability ?? 0);
      return sum + (Number.isFinite(val) ? val : 0) * (Number.isFinite(p) ? p : 0) / 100;
    }, 0);
    const totalWonValue = wonValues.reduce((a, b) => a + b, 0);
    const avgMonthlyWon = totalWonValue / 12;
    const pipelineCoverage = weightedPipeline / Math.max(avgMonthlyWon * 3, 1);

    // Proposal cycle time: try `proposals` table; on 42P01 return null.
    let proposalCycleDays: number | null = null;
    const { data: props, error: propErr } = await (context.supabase as any)
      .from("proposals")
      .select("created_at, sent_at")
      .not("sent_at", "is", null)
      .gte("created_at", cutoff)
      .limit(500);
    if (propErr) {
      if (propErr.code !== "42P01") {
        // Any other error: treat as null and swallow (KPI resilience).
      }
    } else if (props && props.length > 0) {
      const days = props
        .map((p: any) => {
          const c = new Date(p.created_at).getTime();
          const s = new Date(p.sent_at).getTime();
          return (s - c) / (1000 * 60 * 60 * 24);
        })
        .filter((n: number) => Number.isFinite(n) && n >= 0);
      if (days.length > 0) proposalCycleDays = days.reduce((a: number, b: number) => a + b, 0) / days.length;
    }

    return {
      winRate,
      proposalCycleDays,
      avgDealSize,
      avgDealCurrency,
      pipelineCoverage: Number.isFinite(pipelineCoverage) ? pipelineCoverage : null,
    };
  });
