// P-258 — Subcontract detail: header, schedule of values, claims list and the
// retention ledger (held vs released, per certified claim).
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CompliancePanel } from "@/components/procurement/compliance-panel";
import { SubScorecardPanel } from "@/components/procurement/sub-scorecard-panel";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyCell, Num } from "@/components/ui/num";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/locale-provider";
import { getSubcontract, getSubcontractAccess } from "@/lib/subcontracts.functions";
import {
  subcontractAccessQueryOptions,
  subcontractQueryOptions,
  useSaveClaim,
} from "@/lib/subcontracts-query";
import { progressPct } from "@/lib/subcontracts.rules";
import { money } from "@/lib/subcontracts-format";

export const Route = createFileRoute("/_authenticated/procurement/subcontracts/$subcontractId")({
  head: () => ({
    meta: [
      { title: "Subcontract — GridMind EPC" },
      {
        name: "description",
        content: "Subcontract scope, schedule of values, retention ledger and progress claims.",
      },
      { property: "og:title", content: "Subcontract — GridMind EPC" },
      {
        property: "og:description",
        content: "Schedule of values, retention ledger and certified progress claims.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubcontractDetail,
  errorComponent: DetailError,
  notFoundComponent: NotFoundPanel,
});

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
    </div>
  );
}

function SubcontractDetail() {
  const { subcontractId } = Route.useParams();
  const { t } = useI18n();
  const detailFn = useServerFn(getSubcontract);
  const accessFn = useServerFn(getSubcontractAccess);
  const [claimOpen, setClaimOpen] = useState(false);

  const { data } = useSuspenseQuery(subcontractQueryOptions(detailFn, subcontractId));
  const { data: access } = useQuery(subcontractAccessQueryOptions(accessFn));
  const canWrite = access?.canWrite ?? false;

  const sc = data.subcontract;
  const cur = sc.currency_code;
  const pct = progressPct(sc.certified_to_date, sc.contract_value);
  const certifiedClaims = data.claims.filter((c) => c.status === "certified");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sc.subcontract_number ?? ""} · ${sc.title}`.trim()}
        description={`${sc.vendor_name ?? "—"} · ${sc.project_name ?? "—"}`}
        actions={
          canWrite ? (
            <Button onClick={() => setClaimOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t("procurementMod.subcontracts.claims.newClaim")}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("procurementMod.subcontracts.contractValue")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Num className="font-mono text-xl">{money(sc.contract_value, cur)}</Num>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("procurementMod.subcontracts.certifiedToDate")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Num className="font-mono text-xl">{money(sc.certified_to_date, cur)}</Num>
            <Progress value={pct} aria-label={t("procurementMod.subcontracts.progress")} />
            <p className="text-xs text-muted-foreground">
              <Num>{pct.toFixed(1)}%</Num>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("procurementMod.subcontracts.retentionPct")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Num className="font-mono text-xl">{sc.retention_pct}%</Num>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("procurementMod.common.status")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge
              status={sc.status}
              label={t(`procurementMod.subcontracts.status.${sc.status}`)}
            />
          </CardContent>
        </Card>
      </div>

      {sc.scope_summary ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("procurementMod.subcontracts.scope")}</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {sc.scope_summary}
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">
          {t("procurementMod.subcontracts.sov")}
        </h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("procurementMod.common.hash")}</TableHead>
                <TableHead>{t("procurementMod.common.description")}</TableHead>
                <TableHead>{t("procurementMod.common.uom")}</TableHead>
                <TableHead className="text-end">{t("procurementMod.common.qtyShort")}</TableHead>
                <TableHead className="text-end">{t("procurementMod.common.unitPrice")}</TableHead>
                <TableHead className="text-end">{t("procurementMod.common.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell>{l.uom ?? "—"}</TableCell>
                  <TableCell>
                    <MoneyCell>{l.qty}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{money(l.unit_price, cur)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{money(l.amount, cur)}</MoneyCell>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">
            {t("procurementMod.subcontracts.claims.title")}
          </h2>
          {data.claims.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t("procurementMod.subcontracts.claims.empty")}
              compact
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("procurementMod.subcontracts.claims.number")}</TableHead>
                    <TableHead>{t("procurementMod.subcontracts.claims.period")}</TableHead>
                    <TableHead className="text-end">
                      {t("procurementMod.subcontracts.claims.thisPeriod")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("procurementMod.subcontracts.claims.retentionAmount")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("procurementMod.subcontracts.claims.netPayable")}
                    </TableHead>
                    <TableHead>{t("procurementMod.common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          to="/procurement/subcontracts/claims/$claimId"
                          params={{ claimId: c.id }}
                          className="font-mono text-sm text-primary underline-offset-4 hover:underline"
                        >
                          {c.claim_number ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <Num>
                          {c.period_start} → {c.period_end}
                        </Num>
                      </TableCell>
                      <TableCell>
                        <MoneyCell>{money(c.this_period_amount, cur)}</MoneyCell>
                      </TableCell>
                      <TableCell>
                        <MoneyCell>{money(c.retention_amount, cur)}</MoneyCell>
                      </TableCell>
                      <TableCell>
                        <MoneyCell>{money(c.net_payable, cur)}</MoneyCell>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={c.status}
                          label={t(`procurementMod.subcontracts.status.${c.status}`)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("procurementMod.subcontracts.retentionLedger")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("procurementMod.subcontracts.retentionHeld")}
                </dt>
                <dd>
                  <Num className="font-mono">{money(sc.retention_held, cur)}</Num>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("procurementMod.subcontracts.retentionReleased")}
                </dt>
                <dd>
                  <Num className="font-mono">{money(sc.retention_released, cur)}</Num>
                </dd>
              </div>
            </dl>
            <div className="space-y-2 border-t border-border pt-3">
              {certifiedClaims.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("procurementMod.subcontracts.claims.empty")}
                </p>
              ) : (
                certifiedClaims.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.claim_number}
                    </span>
                    <Num className="font-mono">{money(c.retention_amount, cur)}</Num>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {sc.vendor_id ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <CompliancePanel
            vendorId={sc.vendor_id}
            subcontractId={subcontractId}
            canWrite={canWrite}
          />
          <SubScorecardPanel vendorId={sc.vendor_id} canWrite={canWrite} />
        </section>
      ) : null}

      {canWrite ? (
        <NewClaimDialog
          open={claimOpen}
          onOpenChange={setClaimOpen}
          subcontractId={subcontractId}
        />
      ) : null}
    </div>
  );
}

function NewClaimDialog({
  open,
  onOpenChange,
  subcontractId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subcontractId: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const detailFn = useServerFn(getSubcontract);
  const { data } = useQuery(subcontractQueryOptions(detailFn, subcontractId));
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const save = useSaveClaim((id) => {
    onOpenChange(false);
    void navigate({ to: "/procurement/subcontracts/claims/$claimId", params: { claimId: id } });
  });

  const valid = !!start && !!end && end >= start && (data?.lines.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("procurementMod.subcontracts.claims.newClaim")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="claim-start">
              {t("procurementMod.subcontracts.claims.periodStart")}
            </Label>
            <Input
              id="claim-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="claim-end">{t("procurementMod.subcontracts.claims.periodEnd")}</Label>
            <Input
              id="claim-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("procurementMod.subcontracts.cancel")}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate({
                subcontract_id: subcontractId,
                period_start: start,
                period_end: end,
                notes: null,
                lines: (data?.lines ?? []).map((l) => ({
                  subcontract_line_id: l.id,
                  this_period_pct: 0,
                })),
              })
            }
          >
            {t("procurementMod.subcontracts.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotFoundPanel() {
  const { t } = useI18n();
  return <EmptyState icon={FileText} title={t("procurementMod.common.noResults")} />;
}
