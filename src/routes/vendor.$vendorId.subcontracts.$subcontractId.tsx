// P-259 — Sub portal: subcontract detail (SOV + claims) and claim submission.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FileSpreadsheet, Loader2, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { formatDate, formatMoney } from "@/lib/format";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  getSubPortalSubcontract,
  submitSubPortalClaim,
  type SubPortalSovRow,
} from "@/lib/sub-portal.functions";
import {
  claimPayloadLines,
  previewSubClaim,
  remainingPct,
  validateClaimLine,
  validateClaimPeriod,
} from "@/lib/sub-portal.rules";

export const Route = createFileRoute("/vendor/$vendorId/subcontracts/$subcontractId")({
  head: () => ({
    meta: [
      { title: "Subcontract — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Schedule of values, claim history and progress-claim submission for your subcontract package.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubPortalDetailPage,
});

const OPEN_STATUSES = ["draft", "submitted", "under_review"];

function SubPortalDetailPage() {
  const { t } = useI18n();
  const { vendorId, subcontractId } = Route.useParams();
  const detailFn = useServerFn(getSubPortalSubcontract);
  const detail = useQuery({
    queryKey: ["sub-portal", "detail", subcontractId],
    queryFn: () => detailFn({ data: { vendorId, subcontractId } }),
    retry: false,
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <VendorTableSkeleton />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <BackLink vendorId={vendorId} />
        <VendorStateCard
          title={t("portalMod.dashboard.accessExpiredTitle")}
          description={t("portalMod.dashboard.accessExpiredDesc")}
        />
      </div>
    );
  }

  const { subcontract, lines, claims } = detail.data;
  const openClaim = claims.find((c) => OPEN_STATUSES.includes(c.status));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink vendorId={vendorId} />
      <PageHeader
        title={`${subcontract.subcontract_number ?? ""} ${subcontract.title}`.trim()}
        description={subcontract.scope_summary ?? subcontract.project_name ?? undefined}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label={t("portalMod.sub.colValue")}
          value={formatMoney(subcontract.contract_value, subcontract.currency_code)}
        />
        <KpiTile
          label={t("portalMod.sub.kpiCertified")}
          value={formatMoney(subcontract.certified_to_date, subcontract.currency_code)}
        />
        <KpiTile
          label={t("portalMod.sub.kpiRetentionHeld")}
          value={formatMoney(subcontract.retention_held, subcontract.currency_code)}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t("portalMod.sub.sovTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("portalMod.sub.colLine")}</TableHead>
                <TableHead>{t("portalMod.sub.colDescription")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colQty")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colUnitPrice")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colAmount")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colCertifiedPct")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colPendingPct")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.line_no}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-end">{l.qty}</TableCell>
                  <TableCell className="text-end">
                    {formatMoney(l.unit_price, subcontract.currency_code)}
                  </TableCell>
                  <TableCell className="text-end">
                    {formatMoney(l.amount, subcontract.currency_code)}
                  </TableCell>
                  <TableCell className="text-end">{Number(l.certified_pct).toFixed(1)}</TableCell>
                  <TableCell className="text-end">{Number(l.pending_pct).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t("portalMod.sub.claimsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={t("portalMod.sub.claimsTitle")}
              description={t("portalMod.sub.claimsEmpty")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portalMod.sub.colClaim")}</TableHead>
                    <TableHead>{t("portalMod.sub.colPeriod")}</TableHead>
                    <TableHead>{t("portalMod.sub.colStatus")}</TableHead>
                    <TableHead className="text-end">{t("portalMod.sub.colNet")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.claim_number ?? "—"}</TableCell>
                      <TableCell>
                        {formatDate(c.period_start)} – {formatDate(c.period_end)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.status}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {formatMoney(c.net_payable, subcontract.currency_code)}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/vendor/$vendorId/claims/$claimId"
                            params={{ vendorId, claimId: c.id }}
                          >
                            {t("portalMod.sub.openClaim")}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t("portalMod.sub.lockedAfterSubmit")}
          </p>
        </CardContent>
      </Card>

      {subcontract.status !== "active" ? (
        <VendorStateCard
          title={t("portalMod.sub.notActiveTitle")}
          description={t("portalMod.sub.notActiveDesc")}
        />
      ) : openClaim ? (
        <VendorStateCard
          title={t("portalMod.sub.claimOpenTitle")}
          description={t("portalMod.sub.claimOpenDesc")}
        />
      ) : (
        <ClaimForm
          vendorId={vendorId}
          subcontractId={subcontractId}
          currency={subcontract.currency_code}
          retentionPct={Number(subcontract.retention_pct ?? 0)}
          lines={lines}
        />
      )}
    </div>
  );
}

function BackLink({ vendorId }: { vendorId: string }) {
  const { t } = useI18n();
  return (
    <Button variant="ghost" size="sm" asChild className="mb-4">
      <Link to="/vendor/$vendorId/subcontracts" params={{ vendorId }}>
        <ArrowLeft className="me-2 size-4" />
        {t("portalMod.sub.back")}
      </Link>
    </Button>
  );
}

function ClaimForm({
  vendorId,
  subcontractId,
  currency,
  retentionPct,
  lines,
}: {
  vendorId: string;
  subcontractId: string;
  currency: string;
  retentionPct: number;
  lines: SubPortalSovRow[];
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const submitFn = useServerFn(submitSubPortalClaim);

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Record<string, number>>({});

  const preview = useMemo(
    () => previewSubClaim(lines, entries, retentionPct),
    [lines, entries, retentionPct],
  );

  const submit = useMutation({
    mutationFn: async () => {
      const periodError = validateClaimPeriod(periodStart, periodEnd);
      if (periodError) throw new Error(periodError);
      for (const line of lines) {
        const pct = Number(entries[line.id] ?? 0);
        if (!pct) continue;
        const bad = validateClaimLine(line, pct);
        if (bad) throw new Error(bad);
      }
      const payload = claimPayloadLines(
        lines.map((l) => ({
          subcontract_line_id: l.id,
          this_period_pct: Number(entries[l.id] ?? 0),
        })),
      );
      if (payload.length === 0) throw new Error("lines_required");
      return submitFn({
        data: {
          vendorId,
          subcontractId,
          periodStart,
          periodEnd,
          lines: payload,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
    },
    onSuccess: async (res) => {
      toast.success(t("portalMod.sub.submitSuccess"));
      setEntries({});
      setNote("");
      await qc.invalidateQueries({ queryKey: ["sub-portal"] });
      void navigate({
        to: "/vendor/$vendorId/claims/$claimId",
        params: { vendorId, claimId: res.claimId },
      });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : errorCodeOf(err);
      toast.error(translateError(t, code, t("portalMod.documents.genericErrorToast")));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("portalMod.sub.newClaimTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("portalMod.sub.newClaimDesc")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="period-start">{t("portalMod.sub.periodStart")}</Label>
            <Input
              id="period-start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-end">{t("portalMod.sub.periodEnd")}</Label>
            <Input
              id="period-end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((line) => {
            const value = entries[line.id];
            const max = remainingPct(line);
            const invalid = value !== undefined && validateClaimLine(line, value) !== null;
            return (
              <div
                key={line.id}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_10rem] sm:items-end"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {line.line_no}. {line.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(line.amount, currency)} ·{" "}
                    {t("portalMod.sub.remainingHint", {
                      pct: max,
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pct-${line.id}`} className="text-xs">
                    {t("portalMod.sub.colThisPeriod")}
                  </Label>
                  <Input
                    id={`pct-${line.id}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={max}
                    step="0.1"
                    aria-invalid={invalid}
                    value={value ?? ""}
                    onChange={(e) =>
                      setEntries((prev) => ({ ...prev, [line.id]: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Label htmlFor="claim-note">{t("portalMod.sub.noteLabel")}</Label>
          <Textarea
            id="claim-note"
            value={note}
            maxLength={2000}
            placeholder={t("portalMod.sub.notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label={t("portalMod.sub.previewGross")}
            value={formatMoney(preview.thisPeriodAmount, currency)}
          />
          <KpiTile
            label={t("portalMod.sub.previewRetention")}
            value={formatMoney(preview.retentionAmount, currency)}
          />
          <KpiTile
            label={t("portalMod.sub.previewNet")}
            value={formatMoney(preview.netPayable, currency)}
          />
        </div>

        <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
          {submit.isPending ? (
            <Loader2 className="me-2 size-4 animate-spin" />
          ) : (
            <Send className="me-2 size-4" />
          )}
          {t("portalMod.sub.submit")}
        </Button>
      </CardContent>
    </Card>
  );
}
