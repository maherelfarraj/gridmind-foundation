// P-091 — Transmittal server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  canWriteTransmittal,
  nextTransmittalNumber,
  transmittalAckInput,
  transmittalCreateInput,
  transmittalSendInput,
  TRANSMITTAL_DIRECTIONS,
  type TransmittalDirection,
  type TransmittalItem,
} from "@/lib/transmittals.rules";

export interface TransmittalRow {
  id: string;
  company_id: string;
  project_id: string;
  transmittal_number: string;
  direction: TransmittalDirection;
  from_party: string;
  to_party: string;
  subject: string;
  items: TransmittalItem[];
  response_due: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface TransmittalListItem extends TransmittalRow {
  project_name: string | null;
  project_code: string | null;
}
export interface TransmittalDetail {
  transmittal: TransmittalListItem;
  permissions: { canWrite: boolean };
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
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best effort */
  }
}

function mapRow(r: any): TransmittalListItem {
  return {
    ...(r as TransmittalRow),
    items: (r.items ?? []) as TransmittalItem[],
    project_name: r.projects?.name ?? null,
    project_code: r.projects?.code ?? null,
  };
}

async function allocateTransmittalNumber(context: AuthContext, companyId: string): Promise<string> {
  const { data, error } = await context.supabase
    .from("transmittals")
    .select("transmittal_number")
    .eq("company_id", companyId)
    .order("transmittal_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = ((data ?? []) as { transmittal_number: string }[]).map((r) => r.transmittal_number);
  return nextTransmittalNumber(list);
}

const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  direction: z.enum(TRANSMITTAL_DIRECTIONS).nullable().optional(),
  search: z.string().trim().max(200).nullable().optional(),
});

export const listTransmittals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<TransmittalListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("transmittals")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.direction) q = q.eq("direction", data.direction);
    const { data: rows, error } = await q;
    if (error) throw error;
    const term = (data.search ?? "").toLowerCase();
    const mapped = (rows ?? []).map(mapRow);
    if (!term) return mapped;
    return mapped.filter(
      (r) =>
        r.transmittal_number.toLowerCase().includes(term) ||
        r.subject.toLowerCase().includes(term) ||
        r.from_party.toLowerCase().includes(term) ||
        r.to_party.toLowerCase().includes(term),
    );
  });

export const getTransmittal = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<TransmittalDetail> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("transmittals")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "transmittal_not_found");
    const roles = await currentRoles(context);
    return {
      transmittal: mapRow(row),
      permissions: { canWrite: canWriteTransmittal(roles) },
    };
  });

export const createTransmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => transmittalCreateInput.parse(raw))
  .handler(async ({ data, context }): Promise<TransmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteTransmittal(roles)) httpError(403, "forbidden");

    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId) httpError(400, "invalid_project");

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const number = await allocateTransmittalNumber(context, companyId);
      const insertRow = {
        company_id: companyId,
        project_id: data.projectId,
        transmittal_number: number,
        direction: data.direction,
        from_party: data.fromParty,
        to_party: data.toParty,
        subject: data.subject,
        items: data.items as any,
        response_due: data.responseDue ?? null,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("transmittals")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (!error && inserted) {
        await audit(context, "transmittal.create", "transmittals", (inserted as any).id, {
          transmittal_number: number,
          direction: data.direction,
        });
        return {
          ...(inserted as unknown as TransmittalRow),
          items: ((inserted as any).items ?? []) as TransmittalItem[],
        };
      }
      lastErr = error;
      if ((error as any)?.code !== "23505") break;
    }
    throw lastErr ?? new Error("create_failed");
  });

export const sendTransmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => transmittalSendInput.parse(raw))
  .handler(async ({ data, context }): Promise<TransmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteTransmittal(roles)) httpError(403, "forbidden");
    const { data: updated, error } = await context.supabase
      .from("transmittals")
      .update({ sent_at: new Date().toISOString() } as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "transmittal_not_found");
    await audit(context, "transmittal.send", "transmittals", data.id, {});

    // P-269 — notify the external recipient (NEPCO, consultant, sub).
    const row = updated as any;
    const { notify, recipientLocale } = await import("@/lib/email/dispatch.server");
    await notify({
      event: "transmittal",
      to: row.recipient_email ?? null,
      companyId,
      entity: "transmittals",
      entityId: data.id,
      actorId: context.user?.id ?? null,
      locale: await recipientLocale(context.supabase, row.recipient_email ?? ""),
      params: {
        transmittal_number: row.transmittal_number,
        subject: row.subject,
        from_party: row.from_party,
        to_party: row.to_party,
        response_due: row.response_due ?? "",
        item_count: Array.isArray(row.items) ? row.items.length : 0,
      },
    });

    return {
      ...(updated as unknown as TransmittalRow),
      items: ((updated as any).items ?? []) as TransmittalItem[],
    };
  });

export const ackTransmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => transmittalAckInput.parse(raw))
  .handler(async ({ data, context }): Promise<TransmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteTransmittal(roles)) httpError(403, "forbidden");
    const { data: updated, error } = await context.supabase
      .from("transmittals")
      .update({ acknowledged_at: new Date().toISOString() } as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "transmittal_not_found");
    await audit(context, "transmittal.ack", "transmittals", data.id, {});
    return {
      ...(updated as unknown as TransmittalRow),
      items: ((updated as any).items ?? []) as TransmittalItem[],
    };
  });

export const listTransmittalProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; code: string | null }[];
  });

export const listProjectDocuments = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: rows, error } = await context.supabase
      .from("documents")
      .select("id, title, category, file_name")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .order("title", { ascending: true })
      .limit(500);
    if (error) throw error;
    return (rows ?? []) as {
      id: string;
      title: string;
      category: string;
      file_name: string | null;
    }[];
  });
