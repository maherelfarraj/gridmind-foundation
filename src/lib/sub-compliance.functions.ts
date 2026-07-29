// P-260 — Sub compliance register + scorecards (internal half).
//
// Compliance status is derived by the DB trigger (`sub_compliance_status`);
// this layer never writes it. Scorecard math is pure and lives in
// `sub-compliance.rules`; this file only fetches, calls it, and persists.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  ComplianceDocSaveSchema,
  ScorecardComputeSchema,
  computeScorecard,
  type ComplianceDocType,
  type ComplianceStatus,
} from "@/lib/sub-compliance.rules";

const WRITE_ROLES = [
  "project_admin",
  "construction_admin",
  "procurement_admin",
  "procurement_officer",
  "finance_admin",
  "hse_admin",
  "company_admin",
] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as never })),
  );
  return results.some((r) => r?.data === true);
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as { company_id: string | null } | null)?.company_id;
  if (!id) httpError(400, "no_company", "User is not linked to a company.");
  return id;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export interface ComplianceDocRow {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  subcontract_id: string | null;
  doc_type: ComplianceDocType;
  title: string;
  reference: string | null;
  issue_date: string | null;
  expiry_date: string;
  mandatory: boolean;
  status: ComplianceStatus;
  file_path: string | null;
  file_name: string | null;
  notes: string | null;
  updated_at: string;
}

export interface ScorecardRow {
  id: string;
  vendor_id: string;
  period_start: string;
  period_end: string;
  claim_accuracy: number | null;
  safety_score: number | null;
  quality_score: number | null;
  on_time_score: number | null;
  composite: number | null;
  metrics: Record<string, number>;
  computed_at: string;
}

const SELECT_COLS =
  "id, vendor_id, subcontract_id, doc_type, title, reference, issue_date, expiry_date, mandatory, status, file_path, file_name, notes, updated_at, vendors(name)";

type RawDoc = Omit<ComplianceDocRow, "vendor_name"> & { vendors: { name: string } | null };

const mapDoc = (r: RawDoc): ComplianceDocRow => {
  const { vendors, ...rest } = r;
  return { ...rest, vendor_name: vendors?.name ?? null };
};

// ---------------------------------------------------------------------------
// Compliance register
// ---------------------------------------------------------------------------
export const listComplianceDocs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        vendor_id: z.string().uuid().nullish(),
        subcontract_id: z.string().uuid().nullish(),
        include_vendor_level: z.boolean().nullish(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<ComplianceDocRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("subcontract_compliance_docs")
      .select(SELECT_COLS)
      .order("expiry_date", { ascending: true });

    if (data.subcontract_id && data.include_vendor_level && data.vendor_id) {
      // subcontract-specific docs + the sub's vendor-level umbrella docs
      q = q
        .eq("vendor_id", data.vendor_id)
        .or(`subcontract_id.eq.${data.subcontract_id},subcontract_id.is.null`);
    } else if (data.subcontract_id) {
      q = q.eq("subcontract_id", data.subcontract_id);
    } else if (data.vendor_id) {
      q = q.eq("vendor_id", data.vendor_id);
    }

    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map((r) => mapDoc(r as unknown as RawDoc));
  });

export const saveComplianceDoc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ComplianceDocSaveSchema.parse(raw))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const companyId = await currentCompanyId(context);

    // `status` is intentionally absent — the derive trigger owns it.
    const payload = {
      company_id: companyId,
      vendor_id: data.vendor_id,
      subcontract_id: data.subcontract_id ?? null,
      doc_type: data.doc_type,
      title: data.title,
      reference: data.reference ?? null,
      issue_date: data.issue_date ?? null,
      expiry_date: data.expiry_date,
      mandatory: data.doc_type === "insurance" ? true : Boolean(data.mandatory),
      file_path: data.file_path ?? null,
      file_name: data.file_name ?? null,
      notes: data.notes ?? null,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("subcontract_compliance_docs")
        .update(payload)
        .eq("id", data.id);
      if (error) httpError(400, "save_failed", error.message);
      return { id: data.id };
    }

    const { data: row, error } = await context.supabase
      .from("subcontract_compliance_docs")
      .insert({ ...payload, created_by: context.user!.id })
      .select("id")
      .single();
    if (error) httpError(400, "save_failed", error.message);
    return { id: String((row as { id: string }).id) };
  });

export const deleteComplianceDoc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const { error } = await context.supabase
      .from("subcontract_compliance_docs")
      .delete()
      .eq("id", data.id);
    if (error) httpError(400, "delete_failed", error.message);
    return { ok: true };
  });

/** Badge counts for the register header / dashboard chips. */
export const complianceExposure = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ expiring: number; expired: number }> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("subcontract_compliance_docs")
      .select("status")
      .in("status", ["expiring_soon", "expired"]);
    if (error) throw error;
    const rows = (data ?? []) as { status: ComplianceStatus }[];
    return {
      expiring: rows.filter((r) => r.status === "expiring_soon").length,
      expired: rows.filter((r) => r.status === "expired").length,
    };
  });

/** Manual kick of the same sweep the cron runs. */
export const runComplianceSweep = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ refreshed: number; alerts: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const { data, error } = await context.supabase.rpc("sub_compliance_expiry_sweep");
    if (error) httpError(400, "sweep_failed", error.message);
    const res = (data ?? {}) as { refreshed?: number; alerts?: number };

    // P-269 — expiry warnings to the affected subcontractors (non-blocking).
    try {
      const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const { data: docs } = await context.supabase
        .from("subcontract_compliance_docs")
        .select("id, company_id, vendor_id, doc_type, title, expiry_date")
        .lte("expiry_date", horizon)
        .not("expiry_date", "is", null)
        .limit(200);
      const { notify, recipientLocale, vendorEmail } = await import("@/lib/email/dispatch.server");
      for (const raw of (docs ?? []) as Record<string, unknown>[]) {
        const to = await vendorEmail(context.supabase, raw.vendor_id as string | undefined);
        if (!to) continue;
        await notify({
          event: "compliance_expiry",
          to,
          companyId: (raw.company_id as string | undefined) ?? null,
          entity: "subcontract_compliance_docs",
          entityId: (raw.id as string | undefined) ?? null,
          actorId: context.user?.id ?? null,
          locale: await recipientLocale(context.supabase, to),
          params: {
            doc_type: raw.doc_type ?? "",
            title: raw.title ?? "",
            expiry_date: raw.expiry_date ?? "",
          },
        });
      }
    } catch {
      /* notifications never fail the sweep */
    }

    return { refreshed: Number(res.refreshed ?? 0), alerts: Number(res.alerts ?? 0) };
  });

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------
export const listSubScorecards = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ vendor_id: z.string().uuid().nullish() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<ScorecardRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("subcontract_scorecards")
      .select(
        "id, vendor_id, period_start, period_end, claim_accuracy, safety_score, quality_score, on_time_score, composite, metrics, computed_at",
      )
      .order("period_end", { ascending: false })
      .limit(50);
    if (data.vendor_id) q = q.eq("vendor_id", data.vendor_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as unknown as ScorecardRow[];
  });

export const computeSubScorecard = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ScorecardComputeSchema.parse(raw))
  .handler(async ({ context, data }): Promise<ScorecardRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const companyId = await currentCompanyId(context);

    // The sub's contracted work fronts inside this company.
    const { data: subs, error: subsErr } = await context.supabase
      .from("subcontracts")
      .select("id, project_id")
      .eq("vendor_id", data.vendor_id);
    if (subsErr) throw subsErr;
    const subIds = (subs ?? []).map((s) => (s as { id: string }).id);
    const projectIds = [
      ...new Set((subs ?? []).map((s) => (s as { project_id: string }).project_id)),
    ];

    const claims = subIds.length
      ? ((
          await context.supabase
            .from("subcontract_claims")
            .select("net_payable, this_period_amount, status, period_end, submitted_at")
            .in("subcontract_id", subIds)
            .gte("period_end", data.period_start)
            .lte("period_end", data.period_end)
        ).data ?? [])
      : [];

    const incidents = projectIds.length
      ? ((
          await context.supabase
            .from("hse_incidents")
            .select("severity, occurred_at")
            .in("project_id", projectIds)
            .gte("occurred_at", data.period_start)
            .lte("occurred_at", `${data.period_end}T23:59:59Z`)
        ).data ?? [])
      : [];

    const ncrs = projectIds.length
      ? ((
          await context.supabase
            .from("ncrs")
            .select("disposition, created_at")
            .in("project_id", projectIds)
            .gte("created_at", data.period_start)
            .lte("created_at", `${data.period_end}T23:59:59Z`)
        ).data ?? [])
      : [];

    const result = computeScorecard({
      claims: (claims as Record<string, unknown>[]).map((c) => ({
        claimed: Number(c.this_period_amount ?? 0) - 0,
        certified: c.status === "certified" ? Number(c.net_payable ?? 0) : null,
        period_end: String(c.period_end),
        submitted_at: (c.submitted_at as string | null) ?? null,
      })),
      incidents: (incidents as { severity?: string | null }[]).map((i) => ({
        severity: i.severity ?? null,
      })),
      ncrs: (ncrs as { disposition?: string | null }[]).map((n) => ({
        severity: n.disposition ?? null,
      })),
      hasWorkFronts: projectIds.length > 0,
      hasPackages: projectIds.length > 0,
    });

    const { data: row, error } = await context.supabase
      .from("subcontract_scorecards")
      .upsert(
        {
          company_id: companyId,
          vendor_id: data.vendor_id,
          period_start: data.period_start,
          period_end: data.period_end,
          claim_accuracy: result.claim_accuracy,
          safety_score: result.safety_score,
          quality_score: result.quality_score,
          on_time_score: result.on_time_score,
          composite: result.composite,
          metrics: result.metrics as never,
          computed_at: new Date().toISOString(),
          computed_by: context.user!.id,
        },
        { onConflict: "company_id,vendor_id,period_start,period_end" },
      )
      .select(
        "id, vendor_id, period_start, period_end, claim_accuracy, safety_score, quality_score, on_time_score, composite, metrics, computed_at",
      )
      .single();
    if (error) httpError(400, "scorecard_failed", error.message);
    return row as unknown as ScorecardRow;
  });
