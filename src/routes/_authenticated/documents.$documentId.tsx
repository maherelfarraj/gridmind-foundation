// P-265 — Controlled document detail: overview, revision history chain, compare.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, FileClock, GitCompare } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ControlledCopiesTab } from "@/components/documents/controlled-copies-tab";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  getCurrentInLineage,
  getDocumentHistory,
  getDocumentRecord,
} from "@/lib/documents-history.functions";
import { signRegisteredDocumentUrl } from "@/lib/documents-search.functions";
import {
  changedOnly,
  currentNode,
  diffRevisions,
  isVisuallyComparable,
  lineageTone,
  orderLineage,
  type LineageNode,
} from "@/lib/documents-history.rules";

export const Route = createFileRoute("/_authenticated/documents/$documentId")({
  head: () => ({
    meta: [
      { title: "Controlled document — GridMind" },
      {
        name: "description",
        content:
          "Revision history, supersedure chain and side-by-side revision comparison for a controlled document.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { t } = useI18n();
  const { documentId } = Route.useParams();
  const recordFn = useServerFn(getDocumentRecord);
  const historyFn = useServerFn(getDocumentHistory);
  const currentFn = useServerFn(getCurrentInLineage);
  const signFn = useServerFn(signRegisteredDocumentUrl);

  const record = useQuery({
    queryKey: ["document-record", documentId],
    queryFn: () => recordFn({ data: { documentId } }),
  });
  const history = useQuery({
    queryKey: ["document-history", documentId],
    queryFn: () => historyFn({ data: { documentId } }),
  });
  const current = useQuery({
    queryKey: ["document-current", documentId],
    queryFn: () => currentFn({ data: { documentId } }),
  });

  const lineage = useMemo(() => orderLineage(history.data ?? []), [history.data]);
  const live = currentNode(lineage);
  const isHistorical = Boolean(current.data && !current.data.is_self);

  const open = useMutation({
    mutationFn: (id: string) => signFn({ data: { documentId: id } }),
    onSuccess: (res) => {
      if (res.url) window.open(res.url, "_blank", "noopener");
      else toast.error(t("engMod.docHistory.noFile"));
    },
    onError: () => toast.error(t("engMod.docHistory.openFailed")),
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={record.data ? `${record.data.doc_number ?? ""} ${record.data.title}`.trim() : "…"}
        description={t("engMod.docHistory.subtitle")}
      />

      {isHistorical && current.data && (
        <Card className="border-warning/40">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <FileClock className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm">{t("engMod.docHistory.viewingHistorical")}</span>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/documents/$documentId"
                params={{ documentId: current.data.id }}
                className="gap-1"
              >
                {t("engMod.docHistory.jumpToCurrent", { rev: current.data.current_revision })}
                <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("engMod.docHistory.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="history">{t("engMod.docHistory.tabs.history")}</TabsTrigger>
          <TabsTrigger value="copies">{t("engMod.copies.tab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("engMod.docHistory.overviewTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label={t("engMod.docHistory.field.docType")} value={record.data?.doc_type} />
              <Field
                label={t("engMod.docHistory.field.discipline")}
                value={record.data?.discipline}
              />
              <Field
                label={t("engMod.docHistory.field.revision")}
                value={record.data?.current_revision}
              />
              <Field label={t("engMod.docHistory.field.status")} value={record.data?.status} />
              <Field
                label={t("engMod.docHistory.field.retention")}
                value={record.data?.retention_class}
              />
              <Field
                label={t("engMod.docHistory.field.changeSummary")}
                value={record.data?.change_summary}
              />
              <div className="sm:col-span-2">
                <Button size="sm" variant="outline" onClick={() => open.mutate(documentId)}>
                  {t("engMod.docHistory.openFile")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 pt-4">
          {lineage.length === 0 ? (
            <EmptyState
              icon={FileClock}
              title={t("engMod.docHistory.noHistory")}
              description={t("engMod.docHistory.noHistoryHint")}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("engMod.docHistory.chainCount", { count: lineage.length })}
                </p>
                <CompareDialog lineage={lineage} mimeType={record.data?.mime_type ?? null} />
              </div>
              <ol className="space-y-3">
                {lineage.map((node) => (
                  <ChainRow
                    key={node.id}
                    node={node}
                    isViewing={node.id === documentId}
                    isLive={live?.id === node.id}
                  />
                ))}
              </ol>
            </>
          )}
        </TabsContent>

        <TabsContent value="copies" className="pt-4">
          <ControlledCopiesTab record={record.data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChainRow({
  node,
  isViewing,
  isLive,
}: {
  node: LineageNode;
  isViewing: boolean;
  isLive: boolean;
}) {
  const { t } = useI18n();
  const tone = lineageTone(node);
  const toneClass =
    tone === "obsolete"
      ? "line-through text-muted-foreground"
      : tone === "superseded"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <li
      className={`rounded-md border p-3 ${isViewing ? "border-primary" : "border-border"} ${toneClass}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isLive ? "default" : "secondary"}>
          {t("engMod.docHistory.revision", { rev: node.current_revision })}
        </Badge>
        <Badge variant="outline">{node.status}</Badge>
        <span className="text-sm font-medium">{node.title}</span>
        {!isViewing && (
          <Link
            to="/documents/$documentId"
            params={{ documentId: node.id }}
            className="text-xs underline"
          >
            {t("engMod.docHistory.openRevision")}
          </Link>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(node.created_at).toLocaleString()}
        {node.created_by_name ? ` — ${node.created_by_name}` : ""}
      </p>
      {node.change_summary && <p className="mt-1 text-xs">{node.change_summary}</p>}
      {node.superseded_by_id && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("engMod.docHistory.supersededBy")}{" "}
          <Link
            to="/documents/$documentId"
            params={{ documentId: node.superseded_by_id }}
            className="underline"
          >
            {t("engMod.docHistory.viewSuccessor")}
          </Link>
        </p>
      )}
    </li>
  );
}

function CompareDialog({ lineage, mimeType }: { lineage: LineageNode[]; mimeType: string | null }) {
  const { t } = useI18n();
  const [left, setLeft] = useState(lineage[0]?.id ?? "");
  const [right, setRight] = useState(lineage.at(-1)?.id ?? "");
  const a = lineage.find((n) => n.id === left) ?? lineage[0];
  const b = lineage.find((n) => n.id === right) ?? lineage.at(-1);
  const diffs = a && b ? changedOnly(diffRevisions(a, b)) : [];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1" disabled={lineage.length < 2}>
          <GitCompare className="size-3" aria-hidden />
          {t("engMod.docHistory.compare")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("engMod.docHistory.compareTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <RevisionPicker
            id="cmp-a"
            label={t("engMod.docHistory.compareFrom")}
            value={left}
            onChange={setLeft}
            lineage={lineage}
          />
          <RevisionPicker
            id="cmp-b"
            label={t("engMod.docHistory.compareTo")}
            value={right}
            onChange={setRight}
            lineage={lineage}
          />
        </div>

        {b?.change_summary && (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("engMod.docHistory.field.changeSummary")}
            </p>
            <p className="text-sm">{b.change_summary}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {isVisuallyComparable(mimeType, mimeType)
            ? t("engMod.docHistory.visualCompare")
            : t("engMod.docHistory.metadataCompare")}
        </p>

        {diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("engMod.docHistory.noChanges")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="py-1 text-start">{t("engMod.docHistory.diffField")}</th>
                <th className="py-1 text-start">{t("engMod.docHistory.diffBefore")}</th>
                <th className="py-1 text-start">{t("engMod.docHistory.diffAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field} className="border-t border-border">
                  <td className="py-1 pe-2 font-medium">{d.field}</td>
                  <td className="py-1 pe-2 text-muted-foreground">{d.before ?? "—"}</td>
                  <td className="py-1">{d.after ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevisionPicker({
  id,
  label,
  value,
  onChange,
  lineage,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  lineage: LineageNode[];
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {lineage.map((n) => (
            <SelectItem key={n.id} value={n.id}>
              {t("engMod.docHistory.revision", { rev: n.current_revision })} — {n.status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}
