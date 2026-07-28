// P-258 — Claim workspace: internal line-by-line review of a submitted progress
// claim. Certification is never written here — the decision buttons call the
// P-111 engine (`subcontract_claim_certify`), which owns the claim status.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, FileText, Send, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyCell, Num } from "@/components/ui/num";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/locale-provider";
import { getClaim } from "@/lib/subcontracts.functions";
import {
  claimQueryOptions,
  useDecideClaim,
  useSaveClaim,
  useSubmitClaim,
} from "@/lib/subcontracts-query";
import { computeClaimTotals } from "@/lib/subcontracts.rules";
import { money } from "@/lib/subcontracts-format";

export const Route = createFileRoute("/_authenticated/procurement/subcontracts/claims/$claimId")({
  head: () => ({
    meta: [
      { title: "Progress claim — GridMind EPC" },
      {
        name: "description",
        content:
          "Review a subcontractor progress claim line by line and certify or reject it through the approval engine.",
      },
      { property: "og:title", content: "Progress claim — GridMind EPC" },
      {
        property: "og:description",
        content: "Line-by-line progress claim review with retention and net payable.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClaimWorkspace,
  errorComponent: ClaimError,
  notFoundComponent: NotFoundPanel,
});

function ClaimError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
    </div>
  );
}

function ClaimWorkspace() {
  const { claimId } = Route.useParams();
  const { t } = useI18n();
  const claimFn = useServerFn(getClaim);
  const { data } = useSuspenseQuery(claimQueryOptions(claimFn, claimId));

  const { claim, subcontract: sc, approval, canWrite } = data;
  const cur = sc.currency_code;
  const editable = canWrite && (claim.status === "draft" || claim.status === "rejected");

  const [drafts, setDrafts] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.lines.map((l) => [l.id, l.this_period_pct])),
  );
  const [comment, setComment] = useState("");

  const totals = computeClaimTotals(
    data.lines.map((l) => ({
      line_amount: l.line_amount,
      previous_pct: l.previous_pct,
      this_period_pct: editable ? (drafts[l.id] ?? l.this_period_pct) : l.this_period_pct,
    })),
    sc.retention_pct,
  );
  const guardBreached = totals.outOfRangeLines.length > 0;

  const saveClaim = useSaveClaim(() => toast.success(t("procurementMod.subcontracts.saved")));
  const submit = useSubmitClaim(() =>
    toast.success(t("procurementMod.subcontracts.claims.submitted")),
  );
  const decide = useDecideClaim();

  const onDecide = (decision: "approved" | "rejected") => {
    if (!approval) return;
    if (decision === "rejected" && comment.trim().length === 0) {
      toast.error(t("procurementMod.subcontracts.claims.commentRequired"));
      return;
    }
    decide.mutate(
      {
        claim_id: claim.id,
        approval_id: approval.approval_id,
        decision,
        comment: comment.trim() || null,
      },
      {
        onSuccess: () =>
          toast.success(
            decision === "approved"
              ? t("procurementMod.subcontracts.claims.certifiedToast")
              : t("procurementMod.subcontracts.claims.rejectedToast"),
          ),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${claim.claim_number ?? t("procurementMod.subcontracts.claims.claim")}`}
        description={
          <span>
            <Link
              to="/procurement/subcontracts/$subcontractId"
              params={{ subcontractId: sc.id }}
              className="text-primary underline-offset-4 hover:underline"
            >
              {sc.subcontract_number ?? sc.title}
            </Link>{" "}
            · {sc.vendor_name ?? "—"} ·{" "}
            <Num>
              {claim.period_start} → {claim.period_end}
            </Num>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={claim.status}
              label={t(`procurementMod.subcontracts.status.${claim.status}`)}
            />
            {editable ? (
              <>
                <Button
                  variant="outline"
                  disabled={saveClaim.isPending || guardBreached}
                  onClick={() =>
                    saveClaim.mutate({
                      id: claim.id,
                      subcontract_id: sc.id,
                      period_start: claim.period_start,
                      period_end: claim.period_end,
                      notes: claim.notes,
                      lines: data.lines.map((l) => ({
                        subcontract_line_id: l.subcontract_line_id,
                        this_period_pct: drafts[l.id] ?? l.this_period_pct,
                      })),
                    })
                  }
                >
                  {t("procurementMod.subcontracts.save")}
                </Button>
                <Button
                  disabled={submit.isPending || guardBreached}
                  onClick={() => submit.mutate(claim.id)}
                >
                  <Send className="size-4" aria-hidden />
                  {t("procurementMod.subcontracts.claims.submit")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {claim.status === "rejected" && claim.rejection_reason ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {t("procurementMod.subcontracts.claims.rejectionReason")}: {claim.rejection_reason}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          {
            label: t("procurementMod.subcontracts.claims.previousCertified"),
            value: totals.previous_certified,
          },
          {
            label: t("procurementMod.subcontracts.claims.thisPeriod"),
            value: totals.this_period_amount,
          },
          {
            label: t("procurementMod.subcontracts.claims.retentionAmount"),
            value: totals.retention_amount,
          },
          {
            label: t("procurementMod.subcontracts.claims.netPayable"),
            value: totals.net_payable,
          },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tile.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Num className="font-mono text-xl">{money(tile.value, cur)}</Num>
            </CardContent>
          </Card>
        ))}
      </div>

      {guardBreached ? (
        <p role="alert" className="text-sm text-destructive">
          {t("procurementMod.subcontracts.claims.cumulativeGuard")}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t("procurementMod.common.hash")}</TableHead>
              <TableHead>{t("procurementMod.common.description")}</TableHead>
              <TableHead className="text-end">{t("procurementMod.common.amount")}</TableHead>
              <TableHead className="text-end">
                {t("procurementMod.subcontracts.claims.previousPct")}
              </TableHead>
              <TableHead className="w-32 text-end">
                {t("procurementMod.subcontracts.claims.thisPeriodPct")}
              </TableHead>
              <TableHead className="min-w-40">
                {t("procurementMod.subcontracts.claims.cumulativePct")}
              </TableHead>
              <TableHead className="text-end">
                {t("procurementMod.subcontracts.claims.thisPeriod")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.map((l, idx) => {
              const m = totals.lines[idx];
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell>
                    <MoneyCell>{money(l.line_amount, cur)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{m.previous_pct.toFixed(2)}%</MoneyCell>
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        className="text-end"
                        value={String(drafts[l.id] ?? l.this_period_pct)}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [l.id]: Number(e.target.value || 0) }))
                        }
                        aria-label={t("procurementMod.subcontracts.claims.thisPeriodPct")}
                      />
                    ) : (
                      <MoneyCell>{m.this_period_pct.toFixed(2)}%</MoneyCell>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Progress
                        value={Math.max(0, Math.min(100, m.cumulative_pct))}
                        aria-label={t("procurementMod.subcontracts.claims.cumulativePct")}
                      />
                      <div
                        className={
                          m.inRange
                            ? "text-end text-xs text-muted-foreground"
                            : "text-end text-xs text-destructive"
                        }
                      >
                        <Num>{m.cumulative_pct.toFixed(2)}% / 100%</Num>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <MoneyCell>{money(m.this_period_amount, cur)}</MoneyCell>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("procurementMod.subcontracts.claims.workspace")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {approval ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="claim-comment">
                  {t("procurementMod.subcontracts.claims.comment")}
                </Label>
                <Textarea
                  id="claim-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={decide.isPending} onClick={() => onDecide("approved")}>
                  <CheckCircle2 className="size-4" aria-hidden />
                  {t("procurementMod.subcontracts.claims.certify")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={decide.isPending}
                  onClick={() => onDecide("rejected")}
                >
                  <XCircle className="size-4" aria-hidden />
                  {t("procurementMod.subcontracts.claims.reject")}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {claim.approval_instance_id
                ? t("procurementMod.subcontracts.claims.notYourStep")
                : t("procurementMod.subcontracts.claims.decisionPending")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NotFoundPanel() {
  const { t } = useI18n();
  return <EmptyState icon={FileText} title={t("procurementMod.common.noResults")} />;
}
