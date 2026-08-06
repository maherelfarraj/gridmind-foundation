// GC-01 — Invoices & payments drill-down behind the costing workspace.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import { costingWorkspaceQueryOptions } from "@/lib/costing.query";
import { formatCostingMoney, isBookedInvoice, isRecordedPayment } from "@/lib/costing.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices & payments — GridMind EPC" },
      {
        name: "description",
        content: "Payable invoices and recorded payments driving actual and paid cost.",
      },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingWorkspaceQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: InvoicesView,
});

function InvoicesView() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t("financeMod.costing.invoices.title")}
        description={t("financeMod.costing.invoices.description")}
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.invoices.invoices")}
        </h3>
        {data.invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("financeMod.costing.invoices.emptyInvoicesTitle")}
            description={t("financeMod.costing.invoices.emptyInvoicesBody")}
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.invoices.number")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.direction")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.status")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.due")}</TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.invoices.amount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.invoices.paid")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.invoices.inActual")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => {
                  const booked = isBookedInvoice(i.direction, i.status);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{i.direction}</TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{i.due_date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCostingMoney(i.amount, i.currency_code)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCostingMoney(i.paid_amount, i.currency_code)}
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusBadge
                          status={booked ? "included" : "excluded"}
                          tone={booked ? "positive" : "inactive"}
                          label={t(
                            `financeMod.costing.invoices.${booked ? "included" : "excluded"}`,
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.invoices.payments")}
        </h3>
        {data.payments.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("financeMod.costing.invoices.emptyPaymentsTitle")}
            description={t("financeMod.costing.invoices.emptyPaymentsBody")}
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.invoices.number")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.direction")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.status")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.date")}</TableHead>
                  <TableHead>{t("financeMod.costing.invoices.method")}</TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.invoices.amount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.invoices.inPaid")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => {
                  const counted = isRecordedPayment(p.direction, p.record_status);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.payment_number}</TableCell>
                      <TableCell className="text-muted-foreground">{p.direction}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.record_status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.payment_date ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.method ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCostingMoney(p.amount, p.currency_code)}
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusBadge
                          status={counted ? "included" : "excluded"}
                          tone={counted ? "positive" : "inactive"}
                          label={t(
                            `financeMod.costing.invoices.${counted ? "included" : "excluded"}`,
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
