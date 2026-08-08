// GC-07 — Printable close pack: checklist, exceptions, evidence and audit evidence for a period.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { Printer } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { CashAppendixCard } from "@/components/cashflow/cash-appendix";
import { EvmAppendixCard } from "@/components/evm/evm-appendix";
import { riskContingencyAppendixQueryOptions } from "@/lib/risk-contingency.query";
import { RecognitionAppendixCard } from "@/components/recognition/recognition-appendix";
import { RiskContingencyAppendixCard } from "@/components/risk-contingency/risk-appendix";
import { ContractsClaimsAppendixCard } from "@/components/contracts-claims/contracts-claims-appendix";
import { claimsAppendixQueryOptions } from "@/lib/contracts-claims.query";
import { recognitionAppendixQueryOptions } from "@/lib/recognition.query";
import { checklistProgress, groupByCategory } from "@/lib/costing.checklist";
import { cashflowAppendixQueryOptions } from "@/lib/cashflow.query";
import { evmAppendixQueryOptions } from "@/lib/evm.report.query";
import { closeCockpitQueryOptions } from "@/lib/costing.checklist.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const searchSchema = z.object({ period: z.string().optional() });

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/close-pack")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Close pack — GridMind EPC" },
      {
        name: "description",
        content:
          "Printable period close pack: checklist sign-offs, exception register, evidence and audit trail.",
      },
      { property: "og:title", content: "Close pack — GridMind EPC" },
      {
        property: "og:description",
        content: "Period close evidence pack for costing sign-off and audit review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: ClosePackView,
});

const K = "financeMod.costing.cockpit";

function ClosePackView() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const { period } = Route.useSearch();
  const { data } = useSuspenseQuery(closeCockpitQueryOptions(projectId, period));

  const nameOf = (id: string | null | undefined) =>
    id ? (data.people.find((p) => p.id === id)?.name ?? id) : "—";
  const progress = checklistProgress(data.items, data.today);
  const monthLabel = data.close.focusPeriod.slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.pack.title`, { period: monthLabel })}
        description={t(`${K}.pack.description`)}
        actions={
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" /> {t(`${K}.pack.print`)}
          </Button>
        }
      />

      <Card className="flex flex-wrap gap-6 p-4 text-sm">
        <Field label={t(`${K}.pack.project`)} value={data.close.project.name} />
        <Field label={t(`${K}.pack.period`)} value={monthLabel} />
        <Field
          label={t(`${K}.pack.state`)}
          value={t(`financeMod.costing.close.state.${data.close.state}`)}
        />
        <Field
          label={t(`${K}.kpi.progress`)}
          value={progress.pct === null ? "—" : `${progress.pct}%`}
        />
        <Field label={t(`${K}.pack.generated`)} value={data.today} />
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.checklistTitle`)}</h2>
        {groupByCategory(data.items).map((group) => (
          <div key={group.category} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`${K}.category.${group.category}`, { defaultValue: group.category })}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(`${K}.pack.item`)}</TableHead>
                  <TableHead>{t(`${K}.filters.status`)}</TableHead>
                  <TableHead>{t(`${K}.pack.preparer`)}</TableHead>
                  <TableHead>{t(`${K}.pack.reviewer`)}</TableHead>
                  <TableHead>{t(`${K}.pack.evidence`)}</TableHead>
                  <TableHead>{t(`${K}.noteLabel`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => {
                  const evidence = data.evidence.filter((e) => e.item_id === item.id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-foreground">{item.title}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} label={t(`${K}.status.${item.status}`)} />
                      </TableCell>
                      <TableCell>{nameOf(item.completed_by)}</TableCell>
                      <TableCell>{nameOf(item.reviewed_by)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {evidence.length === 0
                          ? "—"
                          : evidence
                              .map((e) => e.document_title ?? e.file_name ?? e.document_id)
                              .join(", ")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.waiver_reason ?? item.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.exceptionsTitle`)}</h2>
        {data.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.noExceptions`)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${K}.exception.title`)}</TableHead>
                <TableHead>{t(`${K}.exception.severity`)}</TableHead>
                <TableHead>{t(`${K}.exception.status`)}</TableHead>
                <TableHead>{t(`${K}.pack.resolvedBy`)}</TableHead>
                <TableHead>{t(`${K}.exception.resolution`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.exceptions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-foreground">{row.title}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.severity === "blocker" ? "blocked" : "warning"}
                      label={t(`${K}.severity.${row.severity}`)}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status}
                      tone={row.status === "accepted_risk" ? "attention" : undefined}
                      label={t(`${K}.exceptionStatus.${row.status}`)}
                    />
                  </TableCell>
                  <TableCell>{nameOf(row.resolved_by)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.resolution_note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <EvmAppendixSection projectId={projectId} period={data.close.focusPeriod} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <CashAppendixSection projectId={projectId} period={data.close.focusPeriod} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <RecognitionAppendixSection projectId={projectId} period={data.close.focusPeriod} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <ClaimsAppendixSection projectId={projectId} period={data.close.focusPeriod} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <RiskAppendixSection projectId={projectId} />
      </Suspense>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.auditTitle`)}</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {data.audit.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {e.created_at.slice(0, 16).replace("T", " ")}
              </span>
              <span className="text-foreground">{e.action}</span>
              <span className="text-muted-foreground">{nameOf(e.actor_id)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

/** GC-12 — earned value appendix for the period being closed. */
function EvmAppendixSection({ projectId, period }: { projectId: string; period: string }) {
  const { data } = useSuspenseQuery(evmAppendixQueryOptions(projectId, period));
  return <EvmAppendixCard appendix={data} />;
}

/** GC-13 — cash-flow & liquidity appendix for the period being closed. */
function CashAppendixSection({ projectId, period }: { projectId: string; period: string }) {
  const { data } = useSuspenseQuery(cashflowAppendixQueryOptions(projectId, period));
  return <CashAppendixCard appendix={data} />;
}

/** GC-15 — governed revenue / WIP appendix for the period being closed. */
function RecognitionAppendixSection({ projectId, period }: { projectId: string; period: string }) {
  const { data } = useSuspenseQuery(recognitionAppendixQueryOptions(projectId, period));
  return <RecognitionAppendixCard appendix={data} />;
}

/** GC-17 — governed risk & contingency appendix for the period being closed. */
function RiskAppendixSection({ projectId }: { projectId: string }) {
  const { data } = useSuspenseQuery(riskContingencyAppendixQueryOptions(projectId));
  return <RiskContingencyAppendixCard appendix={data} />;
}

/** GC-16 — governed contract & claims appendix for the period being closed. */
function ClaimsAppendixSection({ projectId, period }: { projectId: string; period: string }) {
  const { data } = useSuspenseQuery(claimsAppendixQueryOptions(projectId, period));
  return <ContractsClaimsAppendixCard appendix={data} />;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
