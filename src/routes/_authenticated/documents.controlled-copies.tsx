// P-266 — Recall dashboard: outstanding controlled copies, recall-due queue,
// overdue highlighting and a per-holder rollup.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Stamp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getControlledCopyQueue } from "@/lib/controlled-copies.functions";
import {
  holderLabel,
  isRecallDue,
  isRecallOverdue,
  summariseByHolder,
} from "@/lib/controlled-copies.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/documents/controlled-copies")({
  head: () => ({
    meta: [
      { title: "Controlled copies & recalls — GridMind" },
      {
        name: "description",
        content:
          "Outstanding controlled copies, the recall-due queue and per-holder recall exposure across the document register.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ControlledCopiesPage,
});

function ControlledCopiesPage() {
  const { t } = useI18n();
  const [onlyDue, setOnlyDue] = useState(false);
  const queueFn = useServerFn(getControlledCopyQueue);

  const queue = useQuery({
    queryKey: ["controlled-copy-queue", onlyDue],
    queryFn: () => queueFn({ data: { onlyDue } }),
  });

  const rows = useMemo(() => queue.data ?? [], [queue.data]);
  const holders = useMemo(() => summariseByHolder(rows), [rows]);
  const dueCount = rows.filter(isRecallDue).length;
  const overdueCount = rows.filter((r) => isRecallOverdue(r)).length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("engMod.copies.dashboardTitle")}
        description={t("engMod.copies.dashboardSubtitle")}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("engMod.copies.outstanding")} value={rows.length} />
        <StatCard label={t("engMod.copies.recallDue")} value={dueCount} />
        <StatCard label={t("engMod.copies.overdue")} value={overdueCount} tone="danger" />
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={onlyDue ? "outline" : "default"}
          onClick={() => setOnlyDue(false)}
        >
          {t("engMod.copies.filterAll")}
        </Button>
        <Button
          size="sm"
          variant={onlyDue ? "default" : "outline"}
          onClick={() => setOnlyDue(true)}
        >
          {t("engMod.copies.filterDue")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Stamp}
          title={t("engMod.copies.queueEmpty")}
          description={t("engMod.copies.queueEmptyHint")}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("engMod.copies.queueTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${
                  isRecallOverdue(row) ? "border-destructive/60 bg-destructive/5" : "border-border"
                }`}
              >
                <div className="space-y-1">
                  <Link
                    to="/documents/$documentId"
                    params={{ documentId: row.document_id }}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {row.doc_number ?? "—"} · {row.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t("engMod.copies.copyNo", { n: row.copy_number })} · {holderLabel(row)} ·{" "}
                    {t("engMod.copies.pinned", { rev: row.revision_pinned })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{row.doc_status}</Badge>
                  {isRecallOverdue(row) ? (
                    <Badge variant="destructive">{t("engMod.copies.overdue")}</Badge>
                  ) : isRecallDue(row) ? (
                    <Badge variant="destructive">{t("engMod.copies.recallDue")}</Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {holders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("engMod.copies.byHolder")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {holders.map((h) => (
              <div
                key={h.holder}
                className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0"
              >
                <span>{h.holder}</span>
                <span className="text-muted-foreground">
                  {t("engMod.copies.holderSummary", {
                    outstanding: h.outstanding,
                    due: h.due,
                    overdue: h.overdue,
                  })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold ${tone === "danger" && value > 0 ? "text-destructive" : ""}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
