// P-043 — Opportunity detail server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import {
  OPPORTUNITY_STAGES,
  STAGE_PROBABILITY,
  type OpportunityStage,
} from "@/lib/crm.functions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export const TENDER_EVENT_TYPES = [
  "pre_bid_meeting",
  "site_visit",
  "qa_deadline",
  "submission_deadline",
  "bid_opening",
  "clarification",
  "award_announcement",
  "other",
] as const;
export type TenderEventType = (typeof TENDER_EVENT_TYPES)[number];

export interface OpportunityDetail {
  id: string;
  company_id: string;
  name: string;
  account_name: string | null;
  archetype: string | null;
  capacity_mw: number | null;
  estimated_value: number | null;
  currency_code: string;
  expected_decision_date: string | null;
  stage: OpportunityStage;
  probability: number | null;
  competitor: string | null;
  loss_reason: string | null;
  notes: string | null;
  owner_id: string | null;
  owner: { full_name: string | null; email: string | null; avatar_url: string | null } | null;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  lost_at: string | null;
  converted_intake_id: string | null;
}


export interface ContactRow {
  id: string;
  opportunity_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
  updated_at: string;
}

export interface TenderEventRow {
  id: string;
  opportunity_id: string;
  event_type: TenderEventType;
  title: string;
  event_at: string;
  location: string | null;
  notes: string | null;
  reminder_sent_at: string | null;
}

export type ActivityKind = "audit" | "tender" | "proposal";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string; // iso
  actor: { id: string | null; full_name: string | null; email: string | null } | null;
  action: string;
  label: string;
  meta: Record<string, any>;
}

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

async function assertCompanyAdmin(context: any) {
  const { data: ok } = await context.supabase.rpc("has_company_role", {
    p_role: "company_admin",
  });
  if (!ok) httpError(403, "forbidden");
}

async function loadOwner(context: any, id: string | null) {
  if (!id) return null;
  const { data } = await context.supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function auditOpportunity(
  context: any,
  action: string,
  opportunityId: string,
  extra: Record<string, any> = {},
) {
  await context.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "opportunities",
    p_entity_id: opportunityId,
    p_metadata: { opportunity_id: opportunityId, ...extra },
  });
}

// ---------------------------------------------------------------------------
// getOpportunity
// ---------------------------------------------------------------------------
const idInput = z.object({ id: z.string().uuid() });

export const getOpportunity = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<OpportunityDetail | null> => {
    requireSupabaseAuth(context);

    const { data: row, error } = await context.supabase
      .from("opportunities")
      .select(
        "id, company_id, name, account_name, archetype, capacity_mw, estimated_value, currency_code, expected_decision_date, stage, probability, competitor, loss_reason, notes, owner_id, created_at, updated_at, won_at, lost_at, converted_intake_id",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;

    const owner = await loadOwner(context, row.owner_id);
    return { ...(row as any), owner } as OpportunityDetail;
  });

// ---------------------------------------------------------------------------
// updateOpportunity
// ---------------------------------------------------------------------------
const updatePatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    account_name: z.string().trim().max(200).nullable(),
    capacity_mw: z.number().nonnegative().nullable(),
    estimated_value: z.number().nonnegative().nullable(),
    currency_code: z.string().trim().length(3),
    expected_decision_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    competitor: z.string().trim().max(500).nullable(),
    loss_reason: z.string().trim().max(500).nullable(),
    notes: z.string().trim().max(5000).nullable(),
  })
  .partial();

const updateInput = z.object({
  id: z.string().uuid(),
  patch: updatePatch,
});

export const updateOpportunity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    const patch: Record<string, any> = { ...data.patch };
    if (typeof patch.currency_code === "string") {
      patch.currency_code = patch.currency_code.toUpperCase();
    }
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await context.supabase
      .from("opportunities")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw error;

    await auditOpportunity(context, "opportunity.updated", data.id, {
      fields: Object.keys(patch),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export const listContacts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ opportunityId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ContactRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("contacts")
      .select("id, opportunity_id, full_name, title, email, phone, is_primary, notes, updated_at")
      .eq("opportunity_id", data.opportunityId)
      .order("is_primary", { ascending: false })
      .order("full_name", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as ContactRow[];
  });

const saveContactInput = z.object({
  id: z.string().uuid().optional(),
  opportunityId: z.string().uuid(),
  full_name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(50).optional().nullable(),
  is_primary: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const saveContact = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveContactInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    const { data: opp, error: oErr } = await context.supabase
      .from("opportunities")
      .select("id, company_id")
      .eq("id", data.opportunityId)
      .maybeSingle();
    if (oErr) throw oErr;
    if (!opp) httpError(404, "opportunity_not_found");

    // If setting primary, demote siblings first.
    if (data.is_primary) {
      const demote = context.supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("opportunity_id", data.opportunityId)
        .eq("is_primary", true);
      if (data.id) demote.neq("id", data.id);
      const { error: dErr } = await demote;
      if (dErr) throw dErr;
    }

    const payload = {
      opportunity_id: data.opportunityId,
      company_id: (opp as any).company_id,
      full_name: data.full_name,
      title: data.title || null,
      email: data.email ? data.email : null,
      phone: data.phone || null,
      is_primary: data.is_primary,
      notes: data.notes || null,
    };

    let contactId: string;
    if (data.id) {
      const { error } = await context.supabase
        .from("contacts")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      contactId = data.id;
    } else {
      const { data: row, error } = await context.supabase
        .from("contacts")
        .insert({ ...payload, created_by: context.user.id })
        .select("id")
        .single();
      if (error) throw error;
      contactId = row.id as string;
    }

    await auditOpportunity(context, "contact.saved", data.opportunityId, {
      contact_id: contactId,
      full_name: data.full_name,
      is_primary: data.is_primary,
    });
    return { id: contactId };
  });

export const deleteContact = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);

    const { data: row, error: rErr } = await context.supabase
      .from("contacts")
      .select("id, opportunity_id, full_name")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!row) httpError(404, "contact_not_found");

    const { error } = await context.supabase
      .from("contacts")
      .delete()
      .eq("id", data.id);
    if (error) throw error;

    if ((row as any).opportunity_id) {
      await auditOpportunity(
        context,
        "contact.deleted",
        (row as any).opportunity_id,
        { contact_id: data.id, full_name: (row as any).full_name },
      );
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Tender events
// ---------------------------------------------------------------------------
export const listTenderEvents = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ opportunityId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TenderEventRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("tender_events")
      .select("id, opportunity_id, event_type, title, event_at, location, notes, reminder_sent_at")
      .eq("opportunity_id", data.opportunityId)
      .order("event_at", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as TenderEventRow[];
  });

const saveTenderInput = z.object({
  id: z.string().uuid().optional(),
  opportunityId: z.string().uuid(),
  event_type: z.enum(TENDER_EVENT_TYPES),
  title: z.string().trim().min(1).max(200),
  event_at: z.string().min(10).max(40), // ISO
  location: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const saveTenderEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveTenderInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    const { data: opp, error: oErr } = await context.supabase
      .from("opportunities")
      .select("id, company_id")
      .eq("id", data.opportunityId)
      .maybeSingle();
    if (oErr) throw oErr;
    if (!opp) httpError(404, "opportunity_not_found");

    const eventIso = new Date(data.event_at).toISOString();
    const payload = {
      opportunity_id: data.opportunityId,
      company_id: (opp as any).company_id,
      event_type: data.event_type,
      title: data.title,
      event_at: eventIso,
      location: data.location || null,
      notes: data.notes || null,
    };

    let eventId: string;
    if (data.id) {
      const { error } = await context.supabase
        .from("tender_events")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      eventId = data.id;
    } else {
      const { data: row, error } = await context.supabase
        .from("tender_events")
        .insert({ ...payload, created_by: context.user.id })
        .select("id")
        .single();
      if (error) throw error;
      eventId = row.id as string;
    }

    await auditOpportunity(context, "tender_event.saved", data.opportunityId, {
      tender_event_id: eventId,
      event_type: data.event_type,
      title: data.title,
      event_at: eventIso,
    });
    return { id: eventId };
  });

export const deleteTenderEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);

    const { data: row, error: rErr } = await context.supabase
      .from("tender_events")
      .select("id, opportunity_id, title")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!row) httpError(404, "tender_event_not_found");

    const { error } = await context.supabase
      .from("tender_events")
      .delete()
      .eq("id", data.id);
    if (error) throw error;

    if ((row as any).opportunity_id) {
      await auditOpportunity(
        context,
        "tender_event.deleted",
        (row as any).opportunity_id,
        { tender_event_id: data.id, title: (row as any).title },
      );
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Notes (audit-only append)
// ---------------------------------------------------------------------------
const noteInput = z.object({
  opportunityId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const postOpportunityNote = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => noteInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    const { data: opp, error } = await context.supabase
      .from("opportunities")
      .select("id")
      .eq("id", data.opportunityId)
      .maybeSingle();
    if (error) throw error;
    if (!opp) httpError(404, "opportunity_not_found");

    await auditOpportunity(context, "opportunity.note", data.opportunityId, {
      body: data.body,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------
function auditLabel(action: string, meta: Record<string, any>): string {
  switch (action) {
    case "opportunity.created":
      return `created this opportunity`;
    case "opportunity.updated":
      return `updated ${Array.isArray(meta?.fields) ? meta.fields.join(", ") : "details"}`;
    case "opportunity.stage_changed":
      return `moved stage ${meta?.from ?? "?"} → ${meta?.to ?? "?"}`;
    case "opportunity.note":
      return meta?.body ?? "posted a note";
    case "contact.saved":
      return `saved contact ${meta?.full_name ?? ""}`.trim();
    case "contact.deleted":
      return `removed contact ${meta?.full_name ?? ""}`.trim();
    case "tender_event.saved":
      return `saved tender event ${meta?.title ?? ""}`.trim();
    case "tender_event.deleted":
      return `deleted tender event ${meta?.title ?? ""}`.trim();
    case "lead.converted":
      return `converted a lead into this opportunity`;
    default:
      return action;
  }
}

export const getOpportunityActivity = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ opportunityId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ActivityItem[]> => {
    requireSupabaseAuth(context);

    // 1) audits: entity match OR metadata.opportunity_id match
    const filter = `and(entity.eq.opportunities,entity_id.eq.${data.opportunityId}),metadata->>opportunity_id.eq.${data.opportunityId}`;
    const { data: audits, error: aErr } = await context.supabase
      .from("audit_logs")
      .select("id, actor_id, action, entity, entity_id, metadata, created_at")
      .or(filter)
      .order("created_at", { ascending: false })
      .limit(500);
    if (aErr) throw aErr;

    // 2) tender events (also included in audits as .saved, but list here as first-class kind)
    const { data: tenders } = await context.supabase
      .from("tender_events")
      .select("id, event_type, title, event_at, created_at")
      .eq("opportunity_id", data.opportunityId)
      .order("event_at", { ascending: false })
      .limit(200);

    // 3) proposals (may not exist yet)
    let proposals: any[] = [];
    try {
      const { data: pRows, error: pErr } = await context.supabase
        .from("proposals" as any)
        .select("id, version, status, created_at")
        .eq("opportunity_id", data.opportunityId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (pErr && (pErr as any).code !== "42P01") throw pErr;
      proposals = pRows ?? [];
    } catch (err: any) {
      if (err?.code !== "42P01") {
        // swallow — proposals module not shipped yet
      }
    }

    // Resolve actor profiles
    const actorIds = Array.from(
      new Set((audits ?? []).map((r: any) => r.actor_id).filter(Boolean)),
    ) as string[];
    let actorMap: Record<string, any> = {};
    if (actorIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const p of profs ?? []) actorMap[(p as any).id] = p;
    }

    const items: ActivityItem[] = [];
    for (const a of audits ?? []) {
      const meta = (a as any).metadata ?? {};
      items.push({
        id: `audit:${(a as any).id}`,
        kind: "audit",
        at: (a as any).created_at,
        actor: (a as any).actor_id
          ? {
              id: (a as any).actor_id,
              full_name: actorMap[(a as any).actor_id]?.full_name ?? null,
              email: actorMap[(a as any).actor_id]?.email ?? null,
            }
          : null,
        action: (a as any).action,
        label: auditLabel((a as any).action, meta),
        meta,
      });
    }
    for (const t of tenders ?? []) {
      items.push({
        id: `tender:${(t as any).id}`,
        kind: "tender",
        at: (t as any).event_at,
        actor: null,
        action: (t as any).event_type,
        label: `${(t as any).title} — ${(t as any).event_type.replaceAll("_", " ")}`,
        meta: { title: (t as any).title, event_type: (t as any).event_type },
      });
    }
    for (const p of proposals) {
      items.push({
        id: `proposal:${p.id}`,
        kind: "proposal",
        at: p.created_at,
        actor: null,
        action: `proposal.${p.status}`,
        label: `Proposal v${p.version} — ${p.status}`,
        meta: { proposal_id: p.id, version: p.version, status: p.status },
      });
    }

    items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    return items;
  });

// re-export for callers
export { OPPORTUNITY_STAGES, STAGE_PROBABILITY };

// ---------------------------------------------------------------------------
// P-050 — Win conversion: opportunity → project_intake + kick-off pack
// ---------------------------------------------------------------------------

const PROJECT_ARCHETYPES = [
  "utility_pv",
  "standalone_bess",
  "c_and_i_rooftop",
  "hybrid_pv_bess",
  "onshore_wind",
  "green_hydrogen",
  "transmission_substation",
] as const;

export const WIN_ARCHETYPES = PROJECT_ARCHETYPES;

export interface WinConversionPrefill {
  opportunity: {
    id: string;
    company_id: string;
    name: string;
    account_name: string | null;
    archetype: string | null;
    capacity_mw: number | null;
    stage: OpportunityStage;
    converted_intake_id: string | null;
  };
  owners: Array<{ id: string; full_name: string | null; email: string | null }>;
}

export const getWinConversionPrefill = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ opportunityId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<WinConversionPrefill | null> => {
    requireSupabaseAuth(context);

    const { data: opp, error } = await context.supabase
      .from("opportunities")
      .select(
        "id, company_id, name, account_name, archetype, capacity_mw, stage, converted_intake_id",
      )
      .eq("id", data.opportunityId)
      .maybeSingle();
    if (error) throw error;
    if (!opp) return null;

    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", (opp as any).company_id)
      .order("full_name", { ascending: true });

    return {
      opportunity: opp as any,
      owners: (profs ?? []) as any,
    };
  });

const convertInput = z.object({
  opportunityId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  archetype: z.enum(PROJECT_ARCHETYPES),
  capacity_mw: z.number().nonnegative().nullable(),
  offtaker: z.string().trim().max(200).nullable(),
  target_cod: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  owner_id: z.string().uuid().nullable(),
});

export const convertOpportunityToIntake = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => convertInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ intake_id: string; alreadyConverted: boolean }> => {
      requireSupabaseAuth(context);
      await assertCrmWriter(context);

      // Load opportunity (RLS-scoped)
      const { data: opp, error: oErr } = await context.supabase
        .from("opportunities")
        .select("id, company_id, name, stage, converted_intake_id")
        .eq("id", data.opportunityId)
        .maybeSingle();
      if (oErr) throw oErr;
      if (!opp) httpError(404, "opportunity_not_found");
      const o = opp as any;

      if (o.stage === "lost") {
        httpError(409, "cannot_convert_lost_opportunity");
      }

      // Idempotent: existing intake wins
      if (o.converted_intake_id) {
        return { intake_id: o.converted_intake_id as string, alreadyConverted: true };
      }

      // 1) Insert project_intake — enum has no crm_win; use 'opportunity'.
      const intakePayload = {
        company_id: o.company_id,
        name: data.name,
        archetype: data.archetype,
        capacity_mw: data.capacity_mw,
        offtaker: data.offtaker,
        target_cod: data.target_cod,
        status: "new" as const,
        source: "opportunity" as const,
        source_opportunity_id: o.id,
        created_by: (context as any).user?.id ?? null,
        notes: `Converted from opportunity: ${o.name}`,
      };

      const { data: intakeRow, error: iErr } = await context.supabase
        .from("project_intake")
        .insert(intakePayload as any)
        .select("id")
        .single();
      if (iErr) throw iErr;
      const intakeId = (intakeRow as any).id as string;

      // 2) Update opportunity → won (best-effort compensation on failure)
      const { error: uErr } = await context.supabase
        .from("opportunities")
        .update({
          stage: "won",
          won_at: new Date().toISOString(),
          probability: 100,
          converted_intake_id: intakeId,
        } as any)
        .eq("id", o.id);
      if (uErr) {
        // Compensate — delete the orphan intake so the user can retry cleanly.
        await context.supabase.from("project_intake").delete().eq("id", intakeId);
        throw uErr;
      }

      // 3+4) Audit rows — opportunity.won and project_intake.created
      await auditOpportunity(context, "opportunity.won", o.id, {
        intake_id: intakeId,
      });
      await context.supabase.rpc("write_audit_log", {
        p_action: "project_intake.created",
        p_entity: "project_intake",
        p_entity_id: intakeId,
        p_metadata: {
          opportunity_id: o.id,
          source: "crm_win",
        },
      });

      return { intake_id: intakeId, alreadyConverted: false };
    },
  );

// ---------------------------------------------------------------------------
// Kick-off pack — internal branded PDF, uploaded to `documents` bucket
// ---------------------------------------------------------------------------

const kickoffInput = z.object({
  opportunityId: z.string().uuid(),
  intakeId: z.string().uuid(),
});

export const buildKickoffPack = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => kickoffInput.parse(input))
  .handler(async ({ data, context }): Promise<{ path: string }> => {
    requireSupabaseAuth(context);
    await assertCrmWriter(context);

    // Load opportunity (RLS-scoped)
    const { data: opp, error: oErr } = await context.supabase
      .from("opportunities")
      .select("*")
      .eq("id", data.opportunityId)
      .maybeSingle();
    if (oErr) throw oErr;
    if (!opp) httpError(404, "opportunity_not_found");
    const o = opp as any;

    // Confirm intake belongs to same tenant
    const { data: intake, error: iErr } = await context.supabase
      .from("project_intake")
      .select("id, company_id, name, archetype, capacity_mw, offtaker, target_cod")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (iErr) throw iErr;
    if (!intake || (intake as any).company_id !== o.company_id) {
      httpError(404, "intake_not_found");
    }

    const { assertExportAllowed } = await import("@/lib/export-guard");
    await assertExportAllowed(context.supabase, {
      companyId: o.company_id,
      projectId: null,
    });

    // Related data
    const [{ data: contacts }, { data: proposals }, { data: tenders }] =
      await Promise.all([
        context.supabase
          .from("contacts")
          .select("full_name, title, email, phone, is_primary")
          .eq("opportunity_id", o.id)
          .order("is_primary", { ascending: false }),
        context.supabase
          .from("proposals")
          .select(
            "id, version, status, subtotal, contingency_pct, total, currency_code, margin_pct, yield_result, created_at",
          )
          .eq("opportunity_id", o.id)
          .order("version", { ascending: false }),
        context.supabase
          .from("tender_events")
          .select("event_type, title, event_at, location, notes")
          .eq("opportunity_id", o.id)
          .order("event_at", { ascending: true }),
      ]);

    const acceptedProposal =
      (proposals ?? []).find((p: any) =>
        ["accepted", "sent"].includes(p.status),
      ) ?? (proposals ?? [])[0] ?? null;

    // Branding
    const { data: branding } = await context.supabase
      .from("company_branding")
      .select("logo_url, primary_color, accent_color, footer_text")
      .eq("company_id", o.company_id)
      .maybeSingle();

    const { data: company } = await context.supabase
      .from("companies")
      .select("name, legal_name")
      .eq("id", o.company_id)
      .maybeSingle();

    let logoSignedUrl: string | null = null;
    const logoRef = (branding as any)?.logo_url as string | null | undefined;
    if (logoRef) {
      if (/^https?:\/\//i.test(logoRef)) {
        logoSignedUrl = logoRef;
      } else {
        try {
          const { data: signed } = await context.supabase.storage
            .from("documents")
            .createSignedUrl(logoRef, 300);
          logoSignedUrl = signed?.signedUrl ?? null;
        } catch {
          logoSignedUrl = null;
        }
      }
    }

    // Build the PDF
    const { buildKickoffPdf } = await import("@/lib/exports/kickoff-pdf");
    const blob = await buildKickoffPdf({
      opportunity: o,
      intake: intake as any,
      contacts: (contacts ?? []) as any,
      acceptedProposal: acceptedProposal as any,
      tenderEvents: (tenders ?? []) as any,
      company: (company as any) ?? { name: "" },
      branding: {
        primaryColor: (branding as any)?.primary_color ?? null,
        accentColor: (branding as any)?.accent_color ?? null,
        footerText: (branding as any)?.footer_text ?? null,
        logoSignedUrl,
      },
    });

    // Upload via service role (documents bucket is private, RLS-gated).
    const { createServiceRoleClient } = await import(
      "@/integrations/supabase/server"
    );
    const admin = createServiceRoleClient();
    const path = `${o.company_id}/intake/${data.intakeId}/kickoff_pack.pdf`;
    const arrayBuf = await blob.arrayBuffer();
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(path, new Uint8Array(arrayBuf), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw upErr;

    // Append kickoff path note (idempotent — only if not already present)
    const notePrefix = "Kickoff pack:";
    const currentNotes = (o.notes as string | null) ?? "";
    if (!currentNotes.includes(path)) {
      const nextNotes = currentNotes
        ? `${currentNotes}\n${notePrefix} ${path}`
        : `${notePrefix} ${path}`;
      await context.supabase
        .from("opportunities")
        .update({ notes: nextNotes } as any)
        .eq("id", o.id);
    }

    await auditOpportunity(context, "opportunity.kickoff_pack_generated", o.id, {
      intake_id: data.intakeId,
      path,
    });

    return { path };
  });

export const getKickoffPackDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        intakeId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);

    const { data: intake, error } = await context.supabase
      .from("project_intake")
      .select("id, company_id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (error) throw error;
    if (!intake) httpError(404, "intake_not_found");

    const path = `${(intake as any).company_id}/intake/${data.intakeId}/kickoff_pack.pdf`;
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(path, 300);
    if (sErr) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

