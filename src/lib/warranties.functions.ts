// P-108 — Warranty & claims server functions (auth-scoped RPC surface).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  canAdvanceClaim,
  checkWarrantyClaimable,
  claimAdvanceSchema,
  claimSettleSchema,
  warrantyClaimCreateSchema,
  warrantyContractUpsertSchema,
  WARRANTY_TYPES,
  type WarrantyClaimStatus,
  type WarrantyType,
} from "@/lib/warranties.rules";
import { generateClaimNumber } from "@/lib/warranties.server";

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

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
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
  entity: "warranty_contracts" | "warranty_claims",
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
export interface WarrantyRow {
  id: string;
  company_id: string;
  project_id: string;
  equipment_id: string | null;
  vendor_id: string | null;
  warranty_type: WarrantyType;
  start_date: string;
  end_date: string;
  terms: string | null;
  coverage_notes: string | null;
  document_path: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  equipment_tag?: string | null;
  vendor_name?: string | null;
  claim_count?: number;
}

export interface ClaimRow {
  id: string;
  company_id: string;
  warranty_id: string;
  claim_number: string;
  title: string;
  description: string | null;
  status: WarrantyClaimStatus;
  submitted_at: string | null;
  resolved_at: string | null;
  claimed_amount: number | null;
  settled_amount: number | null;
  currency_code: string | null;
  attachments: unknown[];
  created_at: string;
  updated_at: string;
}

const WARRANTY_SELECT =
  "*, project:projects(name), equipment:equipment_registry(tag), vendor:vendors(name), claims:warranty_claims(count)";

function shapeWarranty(r: unknown): WarrantyRow {
  const row = r as WarrantyRow & {
    project?: { name: string } | null;
    equipment?: { tag: string } | null;
    vendor?: { name: string } | null;
    claims?: Array<{ count: number }>;
  };
  return {
    ...row,
    project_name: row.project?.name ?? null,
    equipment_tag: row.equipment?.tag ?? null,
    vendor_name: row.vendor?.name ?? null,
    claim_count: row.claims?.[0]?.count ?? 0,
  };
}

// ---- list / get ------------------------------------------------------------
export const listWarranties = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        project_id: z.string().uuid().optional(),
        warranty_type: z.enum(WARRANTY_TYPES).optional(),
        expiring_within_days: z.number().int().min(0).max(3650).optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("warranty_contracts")
      .select(WARRANTY_SELECT)
      .eq("company_id", companyId)
      .order("end_date", { ascending: true });
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.warranty_type) q = q.eq("warranty_type", data.warranty_type);
    if (typeof data.expiring_within_days === "number") {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() + data.expiring_within_days);
      q = q.lte("end_date", cutoff.toISOString().slice(0, 10));
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    let shaped = (rows ?? []).map(shapeWarranty);
    if (data.q && data.q.length > 0) {
      const needle = data.q.toLowerCase();
      shaped = shaped.filter(
        (w) =>
          (w.equipment_tag ?? "").toLowerCase().includes(needle) ||
          (w.vendor_name ?? "").toLowerCase().includes(needle) ||
          (w.project_name ?? "").toLowerCase().includes(needle) ||
          (w.terms ?? "").toLowerCase().includes(needle),
      );
    }
    return shaped;
  });

export const getWarranty = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("warranty_contracts")
      .select(WARRANTY_SELECT)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    return shapeWarranty(row);
  });

// ---- upsert / delete -------------------------------------------------------
export const upsertWarranty = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => warrantyContractUpsertSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const payload = {
      company_id: companyId,
      project_id: data.project_id,
      equipment_id: data.equipment_id ?? null,
      vendor_id: data.vendor_id ?? null,
      warranty_type: data.warranty_type,
      start_date: data.start_date,
      end_date: data.end_date,
      terms: data.terms ?? null,
      coverage_notes: data.coverage_notes ?? null,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("warranty_contracts")
        .update(payload as never)
        .eq("id", data.id)
        .select(WARRANTY_SELECT)
        .single();
      if (error) throw error;
      const row = shapeWarranty(updated);
      await audit(context, "warranty.update", "warranty_contracts", row.id, {
        equipment_id: row.equipment_id,
      });
      return row;
    }
    const { data: inserted, error } = await context.supabase
      .from("warranty_contracts")
      .insert({ ...payload, created_by: context.user!.id } as never)
      .select(WARRANTY_SELECT)
      .single();
    if (error) throw error;
    const row = shapeWarranty(inserted);
    await audit(context, "warranty.create", "warranty_contracts", row.id, {
      warranty_type: row.warranty_type,
    });
    return row;
  });

export const deleteWarranty = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { error } = await context.supabase
      .from("warranty_contracts")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    await audit(context, "warranty.delete", "warranty_contracts", data.id, {});
    return { ok: true };
  });

// ---- doc upload / download ------------------------------------------------
export const signWarrantyDocumentUploadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        warranty_id: z.string().uuid(),
        filename: z.string().min(1).max(300),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    // Verify the warranty belongs to the caller's company (RLS also blocks,
    // but we fail fast with a clear error).
    const { data: w, error: eW } = await context.supabase
      .from("warranty_contracts")
      .select("id")
      .eq("id", data.warranty_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (eW) throw eW;
    if (!w) httpError(404, "warranty_not_found");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stamp = Date.now();
    const path = `${companyId}/warranties/${data.warranty_id}/${stamp}_${safeName}`;
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: signed?.token ?? "" };
  });

export const saveWarrantyDocumentPath = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ warranty_id: z.string().uuid(), path: z.string().min(1) })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { data: updated, error } = await context.supabase
      .from("warranty_contracts")
      .update({ document_path: data.path } as never)
      .eq("id", data.warranty_id)
      .select(WARRANTY_SELECT)
      .single();
    if (error) throw error;
    const row = shapeWarranty(updated);
    await audit(context, "warranty.doc_upload", "warranty_contracts", row.id, {
      path: data.path,
    });
    return row;
  });

export const signWarrantyDocumentDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ path: z.string().min(1) }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(data.path, 300);
    if (error) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

// ---- claims ----------------------------------------------------------------
export const listClaims = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ warranty_id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("warranty_claims")
      .select("*")
      .eq("warranty_id", data.warranty_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as ClaimRow[];
  });

export const createClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => warrantyClaimCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const isOmAdmin = await hasAnyRole(context, ["om_admin"]);

    const { data: warranty, error: eW } = await context.supabase
      .from("warranty_contracts")
      .select("id, end_date, company_id")
      .eq("id", data.warranty_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (eW) throw eW;
    if (!warranty) httpError(404, "warranty_not_found");
    const w = warranty as { id: string; end_date: string; company_id: string };

    const guard = checkWarrantyClaimable({
      end_date: w.end_date,
      isOmAdmin,
      override_note: data.override_note ?? null,
    });
    if (!guard.ok) httpError(400, guard.code!);

    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < 2) {
      const claimNumber = await generateClaimNumber(context.supabase, companyId);
      const payload = {
        company_id: companyId,
        warranty_id: w.id,
        claim_number: claimNumber,
        title: data.title,
        description: data.description ?? null,
        status: "draft" as const,
        claimed_amount: data.claimed_amount ?? null,
        currency_code: data.currency_code ?? null,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("warranty_claims")
        .insert(payload as never)
        .select("*")
        .single();
      if (!error) {
        const row = inserted as ClaimRow;
        await audit(context, "claim.create", "warranty_claims", row.id, {
          warranty_id: row.warranty_id,
          claim_number: row.claim_number,
          override: !!data.override_note,
        });
        return row;
      }
      if ((error as { code?: string }).code === "23505") {
        attempt += 1;
        lastErr = error;
        continue;
      }
      throw error;
    }
    throw lastErr ?? new Error("failed_to_create_claim");
  });

export const submitClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { data: cur, error: e0 } = await context.supabase
      .from("warranty_claims")
      .select("id, status, claim_number")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!cur) httpError(404, "not_found");
    const c = cur as { id: string; status: WarrantyClaimStatus; claim_number: string };
    if (!canAdvanceClaim(c.status, "submitted")) {
      httpError(400, `invalid_transition:${c.status}->submitted`);
    }
    const { data: updated, error } = await context.supabase
      .from("warranty_claims")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    const row = updated as ClaimRow;
    await audit(context, "claim.submit", "warranty_claims", row.id, {
      claim_number: row.claim_number,
    });
    return row;
  });

export const advanceClaimStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => claimAdvanceSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { data: cur, error: e0 } = await context.supabase
      .from("warranty_claims")
      .select("id, status, claim_number")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!cur) httpError(404, "not_found");
    const c = cur as { id: string; status: WarrantyClaimStatus; claim_number: string };
    if (!canAdvanceClaim(c.status, data.status)) {
      httpError(400, `invalid_transition:${c.status}->${data.status}`);
    }
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "rejected") patch.resolved_at = new Date().toISOString();
    const { data: updated, error } = await context.supabase
      .from("warranty_claims")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    const row = updated as ClaimRow;
    await audit(context, "claim.status", "warranty_claims", row.id, {
      claim_number: row.claim_number,
      from: c.status,
      to: row.status,
      note: data.note ?? null,
    });
    return row;
  });

export const settleClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => claimSettleSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { data: cur, error: e0 } = await context.supabase
      .from("warranty_claims")
      .select("id, status, claim_number")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!cur) httpError(404, "not_found");
    const c = cur as { id: string; status: WarrantyClaimStatus; claim_number: string };
    if (c.status !== "approved") httpError(400, "must_be_approved_to_settle");
    const { data: updated, error } = await context.supabase
      .from("warranty_claims")
      .update({
        status: "settled",
        settled_amount: data.settled_amount,
        currency_code: data.currency_code ?? null,
        resolved_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    const row = updated as ClaimRow;
    await audit(context, "claim.settle", "warranty_claims", row.id, {
      claim_number: row.claim_number,
      settled_amount: data.settled_amount,
      note: data.note ?? null,
    });
    return row;
  });

// ---- KPIs -----------------------------------------------------------------
export interface WarrantyKpis {
  contracts: number;
  activeCoveragePct: number | null; // 0..100 or null when no active equipment
  activeEquipment: number;
  coveredEquipment: number;
  expiringSoon: number;
  openClaims: number;
}

export const getWarrantyKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<WarrantyKpis> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date();
    in90.setUTCDate(in90.getUTCDate() + 90);
    const in90ISO = in90.toISOString().slice(0, 10);

    let equipQ = context.supabase
      .from("equipment_registry")
      .select("id", { count: "exact", head: false })
      .eq("company_id", companyId)
      .eq("status", "active");
    if (data.project_id) equipQ = equipQ.eq("project_id", data.project_id);
    const { data: activeEq, error: eEq } = await equipQ;
    if (eEq) throw eEq;
    const activeIds = new Set((activeEq ?? []).map((e) => (e as { id: string }).id));

    let wQ = context.supabase
      .from("warranty_contracts")
      .select("id, equipment_id, end_date")
      .eq("company_id", companyId)
      .gte("end_date", today);
    if (data.project_id) wQ = wQ.eq("project_id", data.project_id);
    const { data: warranties, error: eW } = await wQ;
    if (eW) throw eW;

    const coveredIds = new Set<string>();
    let expiringSoon = 0;
    for (const w of (warranties ?? []) as Array<{
      id: string;
      equipment_id: string | null;
      end_date: string;
    }>) {
      if (w.equipment_id && activeIds.has(w.equipment_id)) coveredIds.add(w.equipment_id);
      if (w.end_date <= in90ISO) expiringSoon += 1;
    }

    // Contracts total
    let ctQ = context.supabase
      .from("warranty_contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (data.project_id) ctQ = ctQ.eq("project_id", data.project_id);
    const { count: contracts, error: eC } = await ctQ;
    if (eC) throw eC;

    // Open claims
    const { count: openClaims, error: eOc } = await context.supabase
      .from("warranty_claims")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["draft", "submitted", "under_review", "approved"]);
    if (eOc) throw eOc;

    const active = activeIds.size;
    const covered = coveredIds.size;
    const pct = active === 0 ? null : Math.round((covered / active) * 1000) / 10;

    return {
      contracts: contracts ?? 0,
      activeCoveragePct: pct,
      activeEquipment: active,
      coveredEquipment: covered,
      expiringSoon,
      openClaims: openClaims ?? 0,
    };
  });

// ---- pickers --------------------------------------------------------------
export const listWarrantyProjects = createServerFn({ method: "GET" })
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

export const listWarrantyVendors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("vendors")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  });

export const listWarrantyEquipment = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("equipment_registry")
      .select("id, tag, manufacturer")
      .eq("project_id", data.project_id)
      .order("tag", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      tag: string;
      manufacturer: string | null;
    }>;
  });

export const isCurrentUserOmAdmin = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return { isOmAdmin: await hasAnyRole(context, ["om_admin"]) };
  });
