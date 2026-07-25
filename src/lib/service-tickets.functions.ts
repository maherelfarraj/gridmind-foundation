// P-109 — Service tickets & SLA server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  applySlaCreditSchema,
  computeCredit,
  computeDueDates,
  evaluateBreach,
  serviceTicketCreateSchema,
  serviceTicketUpdateSchema,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/service-tickets.rules";
import { generateTicketNumber } from "@/lib/service-tickets.server";
import { WORK_ORDER_PRIORITIES, type WorkOrderPriority } from "@/lib/work-orders.rules";

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
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => r.data === true);
}

async function assertWriter(context: AuthContext): Promise<void> {
  if (!(await hasAnyRole(context, ["om_admin", "company_admin"]))) {
    httpError(403, "forbidden_role");
  }
}

async function audit(
  context: AuthContext,
  action: string,
  entity: "service_tickets" | "sla_records",
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

// ---- types -----------------------------------------------------------------
export interface SlaRecordRow {
  id: string;
  company_id: string;
  service_ticket_id: string;
  response_due_at: string;
  resolution_due_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  response_breached: boolean;
  resolution_breached: boolean;
  breach_minutes: number;
  credit_pct: number;
  credit_amount: number | null;
  currency_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketRow {
  id: string;
  company_id: string;
  project_id: string;
  ticket_number: string;
  title: string;
  description: string | null;
  category: TicketCategory;
  priority: WorkOrderPriority;
  status: TicketStatus;
  related_work_order_id: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  assignee_name?: string | null;
  sla?: SlaRecordRow | null;
}

const TICKET_SELECT =
  "*, project:projects(name), assignee:profiles!service_tickets_assigned_to_fkey(full_name, email), sla:sla_records(*)";

function shapeTicket(r: unknown): TicketRow {
  const row = r as TicketRow & {
    project?: { name: string } | null;
    assignee?: { full_name: string | null; email: string | null } | null;
    sla?: SlaRecordRow | SlaRecordRow[] | null;
  };
  const sla = Array.isArray(row.sla) ? (row.sla[0] ?? null) : (row.sla ?? null);
  return {
    ...row,
    project_name: row.project?.name ?? null,
    assignee_name: row.assignee?.full_name ?? row.assignee?.email ?? null,
    sla,
  };
}

// ---- list / get ------------------------------------------------------------
export const listTickets = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        project_id: z.string().uuid().optional(),
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("service_tickets")
      .select(TICKET_SELECT)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.status) q = q.eq("status", data.status);
    if (data.priority) q = q.eq("priority", data.priority);
    const { data: rows, error } = await q;
    if (error) throw error;
    let shaped = (rows ?? []).map(shapeTicket);
    if (data.q && data.q.length > 0) {
      const needle = data.q.toLowerCase();
      shaped = shaped.filter(
        (t) =>
          t.ticket_number.toLowerCase().includes(needle) ||
          t.title.toLowerCase().includes(needle) ||
          (t.description ?? "").toLowerCase().includes(needle),
      );
    }
    return shaped;
  });

export const getTicket = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("service_tickets")
      .select(TICKET_SELECT)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    return shapeTicket(row);
  });

// ---- create ---------------------------------------------------------------
export const createTicket = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => serviceTicketCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);

    // Retry on unique-number conflict.
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < 2) {
      const ticketNumber = await generateTicketNumber(context.supabase, companyId);
      const payload = {
        company_id: companyId,
        project_id: data.project_id,
        ticket_number: ticketNumber,
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        priority: data.priority,
        status: "open" as TicketStatus,
        related_work_order_id: data.related_work_order_id ?? null,
        assigned_to: data.assigned_to ?? null,
        reported_by: context.user!.id,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("service_tickets")
        .insert(payload as never)
        .select("*")
        .single();
      if (!error) {
        const t = inserted as TicketRow;
        const due = computeDueDates(t.priority, t.created_at);
        const { error: eSla } = await context.supabase.from("sla_records").insert({
          company_id: companyId,
          service_ticket_id: t.id,
          response_due_at: due.response_due_at,
          resolution_due_at: due.resolution_due_at,
        } as never);
        if (eSla) throw eSla;
        await audit(context, "ticket.create", "service_tickets", t.id, {
          ticket_number: t.ticket_number,
          priority: t.priority,
        });
        // Re-read shaped row with sla joined.
        const { data: full } = await context.supabase
          .from("service_tickets")
          .select(TICKET_SELECT)
          .eq("id", t.id)
          .maybeSingle();
        return shapeTicket(full ?? t);
      }
      if ((error as { code?: string }).code === "23505") {
        attempt += 1;
        lastErr = error;
        continue;
      }
      throw error;
    }
    throw lastErr ?? new Error("failed_to_create_ticket");
  });

// ---- update / status transitions ------------------------------------------
async function refreshSlaForTicket(
  context: AuthContext,
  ticketId: string,
  now: Date,
): Promise<void> {
  const { data: t, error: eT } = await context.supabase
    .from("service_tickets")
    .select("id, status, resolved_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (eT) throw eT;
  if (!t) return;

  const { data: sla, error: eSla } = await context.supabase
    .from("sla_records")
    .select("*")
    .eq("service_ticket_id", ticketId)
    .maybeSingle();
  if (eSla) throw eSla;
  if (!sla) return;

  const cur = sla as SlaRecordRow;
  const tRow = t as { status: TicketStatus; resolved_at: string | null };

  const responded_at = cur.responded_at ?? (tRow.status !== "open" ? now.toISOString() : null);
  const resolved_at =
    cur.resolved_at ??
    (tRow.status === "resolved" || tRow.status === "closed"
      ? (tRow.resolved_at ?? now.toISOString())
      : null);

  const breach = evaluateBreach(
    {
      response_due_at: cur.response_due_at,
      resolution_due_at: cur.resolution_due_at,
      responded_at,
      resolved_at,
    },
    now,
  );

  const { error: eUpd } = await context.supabase
    .from("sla_records")
    .update({
      responded_at,
      resolved_at,
      response_breached: breach.response_breached,
      resolution_breached: breach.resolution_breached,
      breach_minutes: breach.breach_minutes,
    } as never)
    .eq("id", cur.id);
  if (eUpd) throw eUpd;
}

export const updateTicket = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => serviceTicketUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);

    const { data: cur, error: e0 } = await context.supabase
      .from("service_tickets")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!cur) httpError(404, "not_found");
    const prev = cur as TicketRow;

    const patch: Record<string, unknown> = {};
    if (data.title != null) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.category) patch.category = data.category;
    if (data.priority) patch.priority = data.priority;
    if (data.status) patch.status = data.status;
    if (data.assigned_to !== undefined) patch.assigned_to = data.assigned_to ?? null;
    if (data.related_work_order_id !== undefined) {
      patch.related_work_order_id = data.related_work_order_id ?? null;
    }
    if (
      data.status &&
      (data.status === "resolved" || data.status === "closed") &&
      !prev.resolved_at
    ) {
      patch.resolved_at = new Date().toISOString();
    }

    const { data: updated, error } = await context.supabase
      .from("service_tickets")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    const row = updated as TicketRow;

    await refreshSlaForTicket(context, row.id, new Date());

    const action =
      data.status && (data.status === "resolved" || data.status === "closed")
        ? "ticket.resolve"
        : "ticket.update";
    await audit(context, action, "service_tickets", row.id, {
      ticket_number: row.ticket_number,
      from: prev.status,
      to: row.status,
    });

    const { data: full } = await context.supabase
      .from("service_tickets")
      .select(TICKET_SELECT)
      .eq("id", row.id)
      .maybeSingle();
    return shapeTicket(full ?? row);
  });

// ---- credits --------------------------------------------------------------
export const applySlaCredit = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => applySlaCreditSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);

    const { data: sla, error: e0 } = await context.supabase
      .from("sla_records")
      .select("*")
      .eq("service_ticket_id", data.ticket_id)
      .maybeSingle();
    if (e0) throw e0;
    if (!sla) httpError(404, "sla_not_found");
    const cur = sla as SlaRecordRow;

    // Recompute breach state at "now" before applying credit.
    const breach = evaluateBreach(cur, new Date());
    const credit = computeCredit({
      response_breached: breach.response_breached,
      resolution_breached: breach.resolution_breached,
      monthlyFee: data.monthly_fee,
    });

    const { data: updated, error } = await context.supabase
      .from("sla_records")
      .update({
        response_breached: breach.response_breached,
        resolution_breached: breach.resolution_breached,
        breach_minutes: breach.breach_minutes,
        credit_pct: credit.credit_pct,
        credit_amount: credit.credit_amount,
        currency_code: data.currency_code ?? cur.currency_code ?? null,
      } as never)
      .eq("id", cur.id)
      .select("*")
      .single();
    if (error) throw error;
    const row = updated as SlaRecordRow;
    await audit(context, "sla.credit_apply", "sla_records", row.id, {
      ticket_id: data.ticket_id,
      credit_pct: row.credit_pct,
      credit_amount: row.credit_amount,
      monthly_fee: data.monthly_fee,
    });
    return row;
  });

// ---- breach log -----------------------------------------------------------
export interface BreachLogRow extends SlaRecordRow {
  ticket_number: string;
  title: string;
  project_name: string | null;
  priority: WorkOrderPriority;
  status: TicketStatus;
}

export const listBreaches = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const q = context.supabase
      .from("sla_records")
      .select(
        "*, ticket:service_tickets!inner(ticket_number, title, priority, status, project_id, project:projects(name))",
      )
      .eq("company_id", companyId)
      .or("response_breached.eq.true,resolution_breached.eq.true")
      .order("updated_at", { ascending: false });
    const { data: rows, error } = await q;
    if (error) throw error;
    let mapped = (
      (rows ?? []) as Array<
        SlaRecordRow & {
          ticket: {
            ticket_number: string;
            title: string;
            priority: WorkOrderPriority;
            status: TicketStatus;
            project_id: string;
            project?: { name: string } | null;
          };
        }
      >
    ).map((r) => ({
      ...r,
      ticket_number: r.ticket.ticket_number,
      title: r.ticket.title,
      priority: r.ticket.priority,
      status: r.ticket.status,
      project_name: r.ticket.project?.name ?? null,
    })) as BreachLogRow[];
    if (data.project_id) {
      mapped = mapped.filter(
        (r) =>
          (rows ?? []).find((row) => row.id === r.id) &&
          (r as unknown as { project_id?: string }).project_id === data.project_id,
      );
    }
    return mapped;
  });

// ---- pickers --------------------------------------------------------------
export const listTicketProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  });

export const listTicketAssignees = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>;
  });

export const listOpenWorkOrders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ project_id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("work_orders")
      .select("id, wo_number, title, status")
      .eq("project_id", data.project_id)
      .in("status", ["open", "assigned", "in_progress", "on_hold"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      wo_number: string;
      title: string;
      status: string;
    }>;
  });
