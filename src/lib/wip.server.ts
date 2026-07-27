// P-197 — WIP report I/O helpers. Kept out of *.functions.ts so the server-fn
// splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveBaseCurrency } from "@/lib/ar-aging.server";
import { hasAnyRole } from "@/lib/payments.server";
import {
  BILLED_INVOICE_STATUSES,
  EARNED_PAY_APP_STATUSES,
  WIP_CONTRACT_STATUSES,
  WIP_FULL_ROLES,
  WIP_READ_ROLES,
  computeWipRows,
  rollupWip,
  todayIso,
  type WipAccessLevel,
  type WipContractInput,
  type WipContractRow,
  type WipInvoiceInput,
  type WipPayAppInput,
  type WipPaymentInput,
  type WipRollup,
} from "@/lib/wip.rules";

export async function resolveWipAccess(ctx: AuthContext): Promise<WipAccessLevel> {
  if (await hasAnyRole(ctx, WIP_FULL_ROLES)) return "full";
  if (await hasAnyRole(ctx, WIP_READ_ROLES)) return "read";
  return "none";
}

export interface WipProjectPick {
  id: string;
  name: string;
  code: string | null;
}

export interface WipDataset {
  rows: WipContractRow[];
  rollup: WipRollup;
  as_of_date: string;
  base_currency: string;
  project: { id: string; name: string; code: string | null } | null;
  prepared_by: string;
}

export async function loadPreparedBy(ctx: AuthContext): Promise<string> {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", ctx.user?.id ?? "")
    .maybeSingle();
  const p = data as { full_name?: string | null; email?: string | null } | null;
  return p?.full_name || p?.email || "—";
}

/** Load contracts / certified pay apps / issued invoices / recorded payments. */
export async function loadWipDataset(
  ctx: AuthContext,
  input: { project_id: string; as_of_date?: string },
): Promise<WipDataset> {
  const asOf = input.as_of_date ?? todayIso();

  const [projectRes, contractsRes, base, preparedBy] = await Promise.all([
    ctx.supabase.from("projects").select("id, name, code").eq("id", input.project_id).maybeSingle(),
    ctx.supabase
      .from("contracts")
      .select("id, contract_number, counterparty, status, value, currency_code, project_id")
      .eq("project_id", input.project_id)
      .in("status", WIP_CONTRACT_STATUSES as never)
      .order("contract_number", { ascending: true }),
    resolveBaseCurrency(ctx, input.project_id),
    loadPreparedBy(ctx),
  ]);
  if (contractsRes.error) throw contractsRes.error;

  const contracts = (contractsRes.data ?? []) as unknown as WipContractInput[];
  const project = (projectRes.data ?? null) as WipProjectPick | null;

  if (contracts.length === 0) {
    return {
      rows: [],
      rollup: rollupWip([]),
      as_of_date: asOf,
      base_currency: base,
      project,
      prepared_by: preparedBy,
    };
  }

  const contractIds = contracts.map((c) => c.id);

  const [payAppsRes, invoicesRes] = await Promise.all([
    ctx.supabase
      .from("pay_applications")
      .select("contract_id, status, period_end, total_certified, retention_amount")
      .in("contract_id", contractIds)
      .in("status", EARNED_PAY_APP_STATUSES as never)
      .lte("period_end", asOf),
    ctx.supabase
      .from("invoices")
      .select("id, contract_id, direction, status, issue_date, amount")
      .in("contract_id", contractIds)
      .eq("direction", "receivable")
      .in("status", BILLED_INVOICE_STATUSES as never)
      .lte("issue_date", asOf),
  ]);
  if (payAppsRes.error) throw payAppsRes.error;
  if (invoicesRes.error) throw invoicesRes.error;

  const payApps = (payAppsRes.data ?? []) as unknown as WipPayAppInput[];
  const invoices = (invoicesRes.data ?? []) as unknown as WipInvoiceInput[];

  let payments: WipPaymentInput[] = [];
  if (invoices.length > 0) {
    const { data, error } = await ctx.supabase
      .from("payments")
      .select("invoice_id, record_status, payment_date, amount")
      .in(
        "invoice_id",
        invoices.map((i) => i.id),
      )
      .eq("record_status", "recorded")
      .lte("payment_date", asOf);
    if (error) throw error;
    payments = (data ?? []) as unknown as WipPaymentInput[];
  }

  const rows = computeWipRows(contracts, payApps, invoices, payments, asOf);
  return {
    rows,
    rollup: rollupWip(rows),
    as_of_date: asOf,
    base_currency: base,
    project,
    prepared_by: preparedBy,
  };
}

export interface WipBranding {
  primaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoSignedUrl: string | null;
}

export interface WipCompany {
  name: string;
  legalName: string | null;
}

export async function loadWipBranding(
  ctx: AuthContext,
): Promise<{ branding: WipBranding; company: WipCompany }> {
  const [companyRes, brandingRes] = await Promise.all([
    ctx.supabase.from("companies").select("id, name, legal_name").limit(1).maybeSingle(),
    ctx.supabase
      .from("company_branding")
      .select("logo_url, primary_color, accent_color, footer_text")
      .limit(1)
      .maybeSingle(),
  ]);
  const b = brandingRes.data as {
    logo_url?: string | null;
    primary_color?: string | null;
    accent_color?: string | null;
    footer_text?: string | null;
  } | null;

  let logoSignedUrl: string | null = null;
  if (b?.logo_url) {
    const { data: signed } = await ctx.supabase.storage
      .from("documents")
      .createSignedUrl(b.logo_url, 900);
    logoSignedUrl = signed?.signedUrl ?? null;
  }

  const c = companyRes.data as { name?: string | null; legal_name?: string | null } | null;
  return {
    branding: {
      primaryColor: b?.primary_color ?? null,
      accentColor: b?.accent_color ?? null,
      footerText: b?.footer_text ?? null,
      logoSignedUrl,
    },
    company: { name: c?.name ?? "Company", legalName: c?.legal_name ?? null },
  };
}
