// P-096 — Commissioning punch closure server functions.
// Rules live in commissioning-punch.rules.ts.
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  assertNoOpenAInput,
  canClosePunch,
  canCloseNow,
  canReadPunchBoard,
  closePunchInput,
  listPunchInput,
  missingParties,
  requiredParties,
  type SignoffParty,
} from "@/lib/commissioning-punch.rules";

function httpError(status: number, code: string, metadata?: Record<string, unknown>): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code, ...(metadata ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
    metadata,
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
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export interface PunchSignoffRow {
  id: string;
  punch_item_id: string;
  signoff_party: SignoffParty;
  signer_name: string | null;
  signed_at: string;
  evidence_file_path: string | null;
  notes: string | null;
}

export interface CommissioningPunchRow {
  id: string;
  company_id: string;
  project_id: string;
  punch_number: string;
  category: "A" | "B" | "C";
  discipline: string;
  area: string;
  description: string;
  status: "open" | "ready_for_review" | "closed" | "void";
  utility_witness_required: boolean;
  due_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  signoffs: PunchSignoffRow[];
}

export interface CommissioningPunchBoard {
  companyId: string;
  items: CommissioningPunchRow[];
  permissions: { canClose: boolean };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
export const listCommissioningPunch = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listPunchInput.parse(raw))
  .handler(async ({ data, context }): Promise<CommissioningPunchBoard> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canReadPunchBoard(roles)) httpError(403, "forbidden_role");

    const { data: items, error } = await context.supabase
      .from("qaqc_punch_items")
      .select(
        "id, company_id, project_id, punch_number, category, discipline, area, description, status, utility_witness_required, due_date, closed_at, closed_by",
      )
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .neq("status", "void")
      .order("category", { ascending: true })
      .order("punch_number", { ascending: true });
    if (error) throw error;

    const itemIds = (items ?? []).map((r: any) => r.id);
    let signoffs: PunchSignoffRow[] = [];
    if (itemIds.length > 0) {
      const { data: sigRows, error: sErr } = await context.supabase
        .from("punch_signoffs")
        .select(
          "id, punch_item_id, signoff_party, signer_name, signed_at, evidence_file_path, notes",
        )
        .in("punch_item_id", itemIds);
      if (sErr) throw sErr;
      signoffs = (sigRows ?? []) as any;
    }

    const byItem = new Map<string, PunchSignoffRow[]>();
    for (const s of signoffs) {
      const list = byItem.get(s.punch_item_id) ?? [];
      list.push(s);
      byItem.set(s.punch_item_id, list);
    }

    const rows: CommissioningPunchRow[] = ((items ?? []) as any[]).map((r) => ({
      ...(r as CommissioningPunchRow),
      signoffs: byItem.get(r.id) ?? [],
    }));

    return {
      companyId,
      items: rows,
      permissions: { canClose: canClosePunch(roles) },
    };
  });

// ---------------------------------------------------------------------------
// closePunchItem
// ---------------------------------------------------------------------------
export interface ClosePunchResult {
  item: CommissioningPunchRow;
  closed: boolean;
  missing_parties: SignoffParty[];
}

export const closePunchItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => closePunchInput.parse(raw))
  .handler(async ({ data, context }): Promise<ClosePunchResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canClosePunch(roles)) httpError(403, "forbidden_role");

    const { data: item, error } = await context.supabase
      .from("qaqc_punch_items")
      .select(
        "id, company_id, project_id, punch_number, category, discipline, area, description, status, utility_witness_required, due_date, closed_at, closed_by",
      )
      .eq("company_id", companyId)
      .eq("id", data.punchItemId)
      .maybeSingle();
    if (error) throw error;
    if (!item) httpError(404, "punch_not_found");
    const row = item as any as CommissioningPunchRow;

    if (row.status === "closed") {
      // idempotent no-op on already-closed items; return current state
      const { data: sigs } = await context.supabase
        .from("punch_signoffs")
        .select(
          "id, punch_item_id, signoff_party, signer_name, signed_at, evidence_file_path, notes",
        )
        .eq("punch_item_id", row.id);
      return {
        item: { ...row, signoffs: (sigs ?? []) as any },
        closed: true,
        missing_parties: [],
      };
    }
    if (row.status === "void") httpError(409, "punch_void");

    // Insert (idempotent) — unique(punch_item_id, signoff_party) handles dupes.
    const { error: insErr } = await context.supabase.from("punch_signoffs").upsert(
      {
        company_id: companyId,
        project_id: row.project_id,
        punch_item_id: row.id,
        category: row.category,
        signoff_party: data.party,
        signed_by: context.user!.id,
        signer_name: data.signerName,
        evidence_file_path: data.evidencePath ?? null,
        notes: data.notes ?? null,
      } as any,
      { onConflict: "punch_item_id,signoff_party", ignoreDuplicates: true },
    );
    if (insErr) throw insErr;

    // Re-fetch all signoffs to compute closure state.
    const { data: sigsAfter, error: sErr } = await context.supabase
      .from("punch_signoffs")
      .select("id, punch_item_id, signoff_party, signer_name, signed_at, evidence_file_path, notes")
      .eq("punch_item_id", row.id);
    if (sErr) throw sErr;
    const signoffs = (sigsAfter ?? []) as PunchSignoffRow[];
    const havePartiesSet = new Set(signoffs.map((s) => s.signoff_party));
    const havePartiesArr = Array.from(havePartiesSet) as SignoffParty[];

    const required = requiredParties(row.category, row.utility_witness_required);
    const missing = missingParties(required, havePartiesArr);
    const shouldClose = canCloseNow(row.category, row.utility_witness_required, havePartiesArr);

    let finalRow = row;
    let closed = false;
    if (shouldClose) {
      const nowIso = new Date().toISOString();
      const { data: updated, error: uErr } = await context.supabase
        .from("qaqc_punch_items")
        .update({
          status: "closed",
          closed_at: nowIso,
          closed_by: context.user!.id,
        } as any)
        .eq("id", row.id)
        .eq("company_id", companyId)
        .select(
          "id, company_id, project_id, punch_number, category, discipline, area, description, status, utility_witness_required, due_date, closed_at, closed_by",
        )
        .maybeSingle();
      if (uErr) throw uErr;
      if (updated) finalRow = updated as any;
      closed = true;

      await audit(context, "punch.closed", "qaqc_punch_items", row.id, {
        category: row.category,
        signoffs: signoffs.map((s) => ({
          party: s.signoff_party,
          signer_name: s.signer_name,
        })),
      });
    } else {
      await audit(context, "punch.signoff_added", "qaqc_punch_items", row.id, {
        category: row.category,
        party: data.party,
        signer_name: data.signerName,
      });
    }

    return {
      item: { ...finalRow, signoffs },
      closed,
      missing_parties: missing,
    };
  });

// ---------------------------------------------------------------------------
// assertNoOpenCategoryAPunch — reusable helper for P-097 (COD) + P-099 (handover)
// ---------------------------------------------------------------------------
export interface OpenACheck {
  ok: true;
  open_count: 0;
  item_refs: [];
}

export const assertNoOpenCategoryAPunch = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => assertNoOpenAInput.parse(raw))
  .handler(async ({ data, context }): Promise<OpenACheck> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data: rows, error } = await context.supabase
      .from("qaqc_punch_items")
      .select("id, punch_number")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .eq("category", "A")
      .neq("status", "closed")
      .neq("status", "void");
    if (error) throw error;

    const items = (rows ?? []) as { id: string; punch_number: string }[];
    if (items.length > 0) {
      httpError(409, "punch_category_a_open", {
        open_count: items.length,
        item_refs: items.map((i) => i.punch_number),
      });
    }
    return { ok: true, open_count: 0, item_refs: [] };
  });
