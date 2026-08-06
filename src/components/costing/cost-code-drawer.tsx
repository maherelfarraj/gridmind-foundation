// GC-02 — Source-document drawer for a CBS node (PO / contract / CO / invoice
// / payment / accrual / forecast), scoped to the node and its descendants.
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { descendantIds, UNASSIGNED_ID, type CbsRow } from "@/lib/costing.cbs";
import type { CostingWorkspaceData } from "@/lib/costing.functions";

export interface CostCodeDrawerProps {
  row: CbsRow | null;
  rows: CbsRow[];
  data: CostingWorkspaceData;
  onOpenChange: (open: boolean) => void;
  labels?: Partial<Record<string, string>>;
}

export function CostCodeDrawer({
  row,
  rows,
  data,
  onOpenChange,
  labels = {},
}: CostCodeDrawerProps) {
  const L = (key: string, fallback: string) => labels[key] ?? fallback;
  const currency = data.baseCurrency;

  const scope = useMemo(() => {
    if (!row) return null;
    if (row.is_unassigned) return { unassigned: true, ids: new Set<string>() };
    return { unassigned: false, ids: new Set(descendantIds(rows, row.id)) };
  }, [row, rows]);

  const known = useMemo(() => new Set(data.costCodes.map((c) => c.id)), [data.costCodes]);
  const inScope = (costCodeId: string | null | undefined): boolean => {
    if (!scope) return false;
    if (scope.unassigned) return !costCodeId || !known.has(costCodeId);
    return Boolean(costCodeId && scope.ids.has(costCodeId));
  };

  const pos = data.commitments.filter((c) => c.kind === "purchase_order" && inScope(c.cost_code_id));
  const subs = data.commitments.filter((c) => c.kind === "subcontract" && inScope(c.cost_code_id));
  const cos = data.commitments.filter((c) => c.kind === "change_order" && inScope(c.cost_code_id));
  const invoices = data.invoices.filter((i) => inScope(i.cost_code_id));
  const payments = data.payments.filter((p) => inScope(p.cost_code_id));
  const accruals = data.accruals.filter((a) => inScope(a.cost_code_id));
  const forecasts = data.forecasts.filter((f) => inScope(f.cost_code_id));

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {row ? (row.is_unassigned ? L("unassigned", "Unassigned") : `${row.code} — ${row.name}`) : ""}
          </SheetTitle>
          <SheetDescription>
            {row
              ? `${L("current", "Current budget")} ${formatMoney(row.current, currency)} · ${L(
                  "eac",
                  "EAC",
                )} ${formatMoney(row.eac, currency)} · ${L("vac", "VAC")} ${formatMoney(
                  row.variance_at_completion,
                  currency,
                )}`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          <Group title={L("purchaseOrders", "Purchase orders")} count={pos.length}>
            {pos.map((p) => (
              <Line
                key={p.id}
                primary={p.reference}
                secondary={p.counterparty ?? ""}
                status={p.status}
                amount={formatMoney(p.amount_base, currency)}
                note={p.currency_code !== currency ? formatMoney(p.amount, p.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("subcontracts", "Contracts & subcontracts")} count={subs.length}>
            {subs.map((s) => (
              <Line
                key={s.id}
                primary={s.reference}
                secondary={s.counterparty ?? ""}
                status={s.status}
                amount={formatMoney(s.amount_base, currency)}
                note={s.currency_code !== currency ? formatMoney(s.amount, s.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("changeOrders", "Change orders")} count={cos.length}>
            {cos.map((c) => (
              <Line
                key={c.id}
                primary={c.reference}
                secondary={c.counterparty ?? ""}
                status={c.status}
                amount={formatMoney(c.amount_base, currency)}
                note={c.currency_code !== currency ? formatMoney(c.amount, c.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("invoices", "Invoices")} count={invoices.length}>
            {invoices.map((i) => (
              <Line
                key={i.id}
                primary={i.invoice_number}
                secondary={formatDate(i.issue_date)}
                status={i.status}
                amount={formatMoney(i.amount_base, currency)}
                note={i.currency_code !== currency ? formatMoney(i.amount, i.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("payments", "Payments")} count={payments.length}>
            {payments.map((p) => (
              <Line
                key={p.id}
                primary={p.payment_number}
                secondary={formatDate(p.payment_date)}
                status={p.record_status}
                amount={formatMoney(p.amount_base, currency)}
                note={p.currency_code !== currency ? formatMoney(p.amount, p.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("accruals", "Accruals")} count={accruals.length}>
            {accruals.map((a) => (
              <Line
                key={a.id}
                primary={a.period}
                secondary={a.description ?? ""}
                status={a.status}
                amount={formatMoney(a.amount_base, currency)}
                note={a.currency_code !== currency ? formatMoney(a.amount, a.currency_code) : null}
              />
            ))}
          </Group>

          <Group title={L("forecasts", "Forecast periods")} count={forecasts.length}>
            {forecasts.map((f) => (
              <Line
                key={f.id}
                primary={f.period}
                secondary={f.notes ?? ""}
                amount={formatMoney(f.etc_amount_base, currency)}
                note={
                  f.currency_code !== currency ? formatMoney(f.etc_amount, f.currency_code) : null
                }
              />
            ))}
          </Group>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge variant="secondary">{count}</Badge>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {children}
        </ul>
      )}
    </section>
  );
}

function Line({
  primary,
  secondary,
  status,
  amount,
  note,
}: {
  primary: string;
  secondary?: string;
  status?: string;
  amount: string;
  note?: string | null;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{primary}</p>
        {secondary ? <p className="truncate text-xs text-muted-foreground">{secondary}</p> : null}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {status ? <StatusBadge status={status} /> : null}
        <div className="text-end">
          <p className="text-sm tabular-nums text-foreground">{amount}</p>
          {note ? <p className="text-xs tabular-nums text-muted-foreground">{note}</p> : null}
        </div>
      </div>
    </li>
  );
}

export { UNASSIGNED_ID };
