// P-080 — Debit notes server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  DebitNoteIdSchema,
  DebitNoteUpsertSchema,
  nextDebitNoteNumber,
  type DebitNoteRow,
} from "@/lib/debit-notes.rules";

const FINANCE_ROLES = ["finance_admin", "company_admin"] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const r = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as any })),
  );
  return r.some((x) => Boolean(x?.data));
}

async function currentCompanyId(ctx: AuthContext & { user: { id: string } }): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as any)?.company_id as string | undefined;
  if (!id) httpError(400, "no_company");
  return id!;
}

async function audit(
  ctx: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await ctx.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "debit_notes",
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toRow(r: any): DebitNoteRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id ?? null,
    contract_id: r.contract_id ?? null,
    invoice_id: r.invoice_id ?? null,
    note_number: r.note_number,
    status: r.status,
    reason: r.reason,
    amount: Number(r.amount ?? 0),
    currency_code: r.currency_code,
    issued_at: r.issued_at ?? null,
    settled_at: r.settled_at ?? null,
    notes: r.notes ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const listDebitNotes = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid().optional(),
        status: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: DebitNoteRow[] }> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("debit_notes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const upsertDebitNote = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DebitNoteUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<DebitNoteRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context as AuthContext & { user: { id: string } });

    if (data.id) {
      const { data: cur, error } = await context.supabase
        .from("debit_notes")
        .select("status")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw error;
      if (!cur) httpError(404, "not_found");
      if ((cur as any).status !== "draft") {
        httpError(400, "not_draft", "Only draft debit notes can be edited.");
      }
      const { data: upd, error: uErr } = await context.supabase
        .from("debit_notes")
        .update({
          project_id: data.project_id ?? null,
          contract_id: data.contract_id ?? null,
          invoice_id: data.invoice_id ?? null,
          reason: data.reason,
          amount: data.amount,
          currency_code: data.currency_code,
          notes: data.notes ?? null,
        } as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (uErr) throw uErr;
      const row = toRow(upd);
      await audit(context, "debit_note.update", row.id, {
        amount: row.amount,
        reason: row.reason,
      });
      return row;
    }

    // On create we allocate a placeholder number "DRAFT-<uuid-ish>"; the real
    // DN-#### number is stamped at issue time so numbering is gap-free.
    const placeholder = `DRAFT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const { data: ins, error: iErr } = await context.supabase
      .from("debit_notes")
      .insert({
        company_id: companyId,
        project_id: data.project_id ?? null,
        contract_id: data.contract_id ?? null,
        invoice_id: data.invoice_id ?? null,
        note_number: placeholder,
        status: "draft",
        reason: data.reason,
        amount: data.amount,
        currency_code: data.currency_code,
        notes: data.notes ?? null,
        created_by: context.user!.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (iErr) throw iErr;
    const row = toRow(ins);
    await audit(context, "debit_note.create", row.id, {
      amount: row.amount,
      reason: row.reason,
    });
    return row;
  });

export const issueDebitNote = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DebitNoteIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<DebitNoteRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context as AuthContext & { user: { id: string } });

    const { data: cur, error } = await context.supabase
      .from("debit_notes")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!cur) httpError(404, "not_found");
    const row = toRow(cur);
    if (row.status !== "draft") httpError(400, "not_draft", "Only draft debit notes can be issued.");
    if (!row.contract_id && !row.invoice_id) {
      httpError(400, "missing_link", "Link the debit note to a contract or invoice before issuing.");
    }

    const { data: nums, error: nErr } = await context.supabase
      .from("debit_notes")
      .select("note_number")
      .eq("company_id", companyId)
      .like("note_number", "DN-%");
    if (nErr) throw nErr;
    const noteNumber = nextDebitNoteNumber(
      ((nums ?? []) as any[]).map((x) => String(x.note_number)),
    );

    const { data: upd, error: uErr } = await context.supabase
      .from("debit_notes")
      .update({
        status: "issued",
        note_number: noteNumber,
        issued_at: new Date().toISOString().slice(0, 10),
      } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (uErr) throw uErr;
    const out = toRow(upd);
    await audit(context, "debit_note.issue", out.id, {
      note_number: out.note_number,
      amount: out.amount,
    });
    return out;
  });

export const settleDebitNote = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DebitNoteIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<DebitNoteRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const { data: upd, error } = await context.supabase
      .from("debit_notes")
      .update({ status: "settled", settled_at: new Date().toISOString().slice(0, 10) } as any)
      .eq("id", data.id)
      .eq("status", "issued" as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!upd) httpError(400, "not_issued", "Only issued debit notes can be settled.");
    const row = toRow(upd);
    await audit(context, "debit_note.settle", row.id, {
      note_number: row.note_number,
      amount: row.amount,
    });
    return row;
  });

export const cancelDebitNote = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DebitNoteIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<DebitNoteRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const { data: upd, error } = await context.supabase
      .from("debit_notes")
      .update({ status: "cancelled" } as any)
      .eq("id", data.id)
      .in("status", ["draft", "issued"] as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!upd) httpError(400, "not_cancellable");
    const row = toRow(upd);
    await audit(context, "debit_note.cancel", row.id, { note_number: row.note_number });
    return row;
  });
