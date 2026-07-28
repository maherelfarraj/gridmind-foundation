// P-259 — Sub portal: claim workspace (read-only after submission) + messages.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessagesSquare, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
import { addSubPortalClaimMessage, getSubPortalClaim } from "@/lib/sub-portal.functions";

export const Route = createFileRoute("/vendor/$vendorId/claims/$claimId")({
  head: () => ({
    meta: [
      { title: "Progress claim — GridMind Vendor Portal" },
      {
        name: "description",
        content: "Line-by-line detail, certification status and messages for your progress claim.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubPortalClaimPage,
});

function SubPortalClaimPage() {
  const { t } = useI18n();
  const { vendorId, claimId } = Route.useParams();
  const qc = useQueryClient();
  const claimFn = useServerFn(getSubPortalClaim);
  const messageFn = useServerFn(addSubPortalClaimMessage);
  const [body, setBody] = useState("");

  const key = ["sub-portal", "claim", claimId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => claimFn({ data: { vendorId, claimId } }),
    retry: false,
  });

  const send = useMutation({
    mutationFn: () => messageFn({ data: { vendorId, claimId, body: body.trim() } }),
    onSuccess: async () => {
      toast.success(t("portalMod.sub.messageSent"));
      setBody("");
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : errorCodeOf(err);
      toast.error(translateError(t, code, t("portalMod.documents.genericErrorToast")));
    },
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <VendorTableSkeleton />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <VendorStateCard
          title={t("portalMod.dashboard.accessExpiredTitle")}
          description={t("portalMod.dashboard.accessExpiredDesc")}
        />
      </div>
    );
  }

  const { claim, subcontract, lines, messages } = q.data;
  const currency = subcontract.currency_code;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link
          to="/vendor/$vendorId/subcontracts/$subcontractId"
          params={{ vendorId, subcontractId: claim.subcontract_id }}
        >
          <ArrowLeft className="me-2 size-4" />
          {t("portalMod.sub.back")}
        </Link>
      </Button>

      <PageHeader
        title={t("portalMod.sub.claimTitle", { number: claim.claim_number ?? "—" })}
        description={t("portalMod.sub.claimPeriod", {
          start: formatDate(claim.period_start),
          end: formatDate(claim.period_end),
        })}
      />

      <div className="mb-4 flex items-center gap-2">
        <Badge variant="outline">{claim.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {t("portalMod.sub.lockedAfterSubmit")}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label={t("portalMod.sub.previewGross")}
          value={formatMoney(claim.this_period_amount, currency)}
        />
        <KpiTile
          label={t("portalMod.sub.previewRetention")}
          value={formatMoney(claim.retention_amount, currency)}
        />
        <KpiTile
          label={t("portalMod.sub.previewNet")}
          value={formatMoney(claim.net_payable, currency)}
        />
      </div>

      {claim.rejection_reason ? (
        <Card className="mb-6 border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">{t("portalMod.sub.rejectionReason")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {claim.rejection_reason}
          </CardContent>
        </Card>
      ) : null}

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
                <TableHead className="text-end">{t("portalMod.sub.colAmount")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.claimPrevious")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.colThisPeriod")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.claimCumulative")}</TableHead>
                <TableHead className="text-end">{t("portalMod.sub.previewGross")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.line_no}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-end">{formatMoney(l.line_amount, currency)}</TableCell>
                  <TableCell className="text-end">{Number(l.previous_pct).toFixed(1)}</TableCell>
                  <TableCell className="text-end">{Number(l.this_period_pct).toFixed(1)}</TableCell>
                  <TableCell className="text-end">{Number(l.cumulative_pct).toFixed(1)}</TableCell>
                  <TableCell className="text-end">
                    {formatMoney(l.this_period_amount, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessagesSquare className="size-4" aria-hidden />
            {t("portalMod.sub.messagesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title={t("portalMod.sub.messagesTitle")}
              description={t("portalMod.sub.messagesEmpty")}
            />
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <li key={m.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {m.author_type === "sub"
                      ? t("portalMod.sub.authorSub")
                      : t("portalMod.sub.authorInternal")}{" "}
                    · {formatDateTime(m.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <Textarea
              value={body}
              maxLength={4000}
              placeholder={t("portalMod.sub.messagePlaceholder")}
              onChange={(e) => setBody(e.target.value)}
              aria-label={t("portalMod.sub.messagePlaceholder")}
            />
            <Button
              onClick={() => send.mutate()}
              disabled={send.isPending || body.trim().length === 0}
            >
              {send.isPending ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <Send className="me-2 size-4" />
              )}
              {t("portalMod.sub.sendMessage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
