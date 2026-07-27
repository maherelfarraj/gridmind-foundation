// P-199 — Finance alerts cron evaluation (service-role I/O, no HTTP concerns).
import {
  evaluateArAging,
  evaluateOverdueInvoices,
  evaluateUnbilledCertified,
  evaluateUnmatchedPayments,
  type AlertCandidate,
  type FinanceAlertRuleType,
} from "@/lib/finance-alerts.rules";
import { computeWipRows } from "@/lib/wip.rules";
import type { AgingBucketKey } from "@/lib/finance/aging-weights";

export class MissingTableError extends Error {
  constructor(public table: string) {
    super(`missing_table:${table}`);
  }
}

type Admin = {
  from: (t: string) => any;
};

function guard(table: string, error: { code?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01") throw new MissingTableError(table);
  throw error as Error;
}

async function select(admin: Admin, table: string, cols: string, companyId: string) {
  const { data, error } = await admin.from(table).select(cols).eq("company_id", companyId);
  guard(table, error);
  return (data ?? []) as Record<string, any>[];
}

export interface CompanyRule {
  id: string;
  company_id: string;
  rule_type: FinanceAlertRuleType;
  threshold: Record<string, any>;
  notify_role: string;
}

export interface RuleOutcome {
  rule: CompanyRule;
  candidates: AlertCandidate[];
}

/** Evaluate every enabled rule for one company. */
export async function evaluateCompanyRules(
  admin: Admin,
  companyId: string,
  rules: CompanyRule[],
  today: string,
): Promise<RuleOutcome[]> {
  const out: RuleOutcome[] = [];
  let invoices: Record<string, any>[] | null = null;
  const loadInvoices = async () => {
    invoices ??= await select(
      admin,
      "invoices",
      "id, invoice_number, direction, status, due_date, amount, tax_amount, paid_amount, contract_id, issue_date",
      companyId,
    );
    return invoices;
  };

  for (const rule of rules) {
    let candidates: AlertCandidate[] = [];
    if (rule.rule_type === "overdue_invoice_days") {
      const days = Number(rule.threshold?.days ?? 0);
      candidates = evaluateOverdueInvoices(
        (await loadInvoices()).map((i) => ({
          id: i.id,
          invoice_number: i.invoice_number ?? i.id,
          direction: i.direction,
          status: i.status,
          due_date: i.due_date ?? null,
          amount: Number(i.amount ?? 0),
          tax_amount: Number(i.tax_amount ?? 0),
          paid_amount: Number(i.paid_amount ?? 0),
        })),
        days,
        today,
      );
    } else if (rule.rule_type === "ar_aging_threshold") {
      candidates = evaluateArAging(
        companyId,
        (await loadInvoices()).map((i) => ({
          direction: i.direction,
          status: i.status,
          due_date: i.due_date ?? null,
          amount: Number(i.amount ?? 0),
          tax_amount: Number(i.tax_amount ?? 0),
          paid_amount: Number(i.paid_amount ?? 0),
        })),
        (rule.threshold?.bucket ?? "d90_plus") as AgingBucketKey,
        Number(rule.threshold?.amount_base ?? 0),
        today,
      );
    } else if (rule.rule_type === "unbilled_certified_value") {
      const contracts = await select(
        admin,
        "contracts",
        "id, contract_number, counterparty, status, value, currency_code, project_id",
        companyId,
      );
      const payApps = await select(
        admin,
        "pay_applications",
        "contract_id, status, period_end, total_certified, retention_amount",
        companyId,
      );
      const inv = await loadInvoices();
      const payments = await select(
        admin,
        "payments",
        "invoice_id, record_status, payment_date, amount",
        companyId,
      );
      const rows = computeWipRows(
        contracts as never,
        payApps as never,
        inv as never,
        payments as never,
        today,
      );
      candidates = evaluateUnbilledCertified(
        rows.map((r) => ({
          contract_id: r.contract_id,
          contract_number: r.contract_number,
          earned: r.earned,
          billed: r.billed,
        })),
        Number(rule.threshold?.amount_base ?? 0),
      );
    } else if (rule.rule_type === "payment_unmatched_days") {
      const payments = await select(
        admin,
        "payments",
        "id, payment_number, record_status, reconciliation_status, payment_date",
        companyId,
      );
      candidates = evaluateUnmatchedPayments(
        payments as never,
        Number(rule.threshold?.days ?? 0),
        today,
      );
    }
    out.push({ rule, candidates });
  }
  return out;
}
