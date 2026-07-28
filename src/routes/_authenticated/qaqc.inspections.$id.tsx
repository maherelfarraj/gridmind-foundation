// P-089 — QA/QC inspection detail (view + inline edit).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentList } from "@/components/qaqc/attachment-list";
import { QaqcResultBadge } from "@/components/qaqc/result-badge";
import { errorMessage, inspectionDetailQueryOptions } from "@/lib/qaqc-query";
import { updateInspection } from "@/lib/qaqc.functions";
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import {
  QAQC_DISCIPLINES,
  QAQC_DISCIPLINE_LABELS,
  QAQC_RESULTS,
  type QaqcAttachment,
  type QaqcDiscipline,
  type QaqcResult,
} from "@/lib/qaqc.rules";

export const Route = createFileRoute("/_authenticated/qaqc/inspections/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Inspection ${params.id.slice(0, 8)} — GridMind EPC` },
      { name: "description", content: "QA/QC inspection detail." },
      { property: "og:title", content: "QA/QC inspection" },
      {
        property: "og:description",
        content: "Inspection detail, result, and attachments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InspectionDetailPage,
});

function InspectionDetailPage() {
  const { t } = useI18n();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const detailQuery = useQuery(inspectionDetailQueryOptions(id));
  const data = detailQuery.data;

  const [discipline, setDiscipline] = useState<QaqcDiscipline>("civil");
  const [area, setArea] = useState("");
  const [itpRef, setItpRef] = useState("");
  const [inspectionDate, setInspectionDate] = useState("");
  const [result, setResult] = useState<QaqcResult>("pending");
  const [reworkRequired, setReworkRequired] = useState(false);
  const [reworkNotes, setReworkNotes] = useState("");
  const [attachments, setAttachments] = useState<QaqcAttachment[]>([]);

  useEffect(() => {
    if (!data) return;
    const i = data.inspection;
    setDiscipline(i.discipline);
    setArea(i.area);
    setItpRef(i.itp_reference ?? "");
    setInspectionDate(i.inspection_date);
    setResult(i.result);
    setReworkRequired(i.rework_required);
    setReworkNotes(i.rework_notes ?? "");
    setAttachments(i.attachments ?? []);
  }, [data]);

  const updateMut = useMutation({
    mutationFn: () =>
      updateInspection({
        data: {
          id,
          discipline,
          area,
          itpReference: itpRef || null,
          inspectionDate,
          result,
          reworkRequired,
          reworkNotes: reworkNotes || null,
          attachments,
        } as any,
      }),
    onSuccess: async () => {
      toast.success(t("fieldMod.qaqc.inspection.updated"));
      await qc.invalidateQueries({ queryKey: ["qaqc"] });
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="page-shell">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (detailQuery.isError || !data) {
    return (
      <div className="page-shell">
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {errorMessage(detailQuery.error) || t("fieldMod.qaqc.inspection.notFound")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const i = data.inspection;
  const canEdit = data.permissions.canEdit;
  const clientReworkError =
    reworkRequired && !reworkNotes.trim()
      ? t("fieldMod.qaqc.inspection.reworkNotesRequired")
      : null;

  return (
    <div className="page-shell">
      <div>
        <Link
          to="/qaqc/inspections"
          className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> {t("fieldMod.qaqc.inspection.backToInspections")}
        </Link>
        <PageHeader
          title={i.inspection_number}
          description={t("fieldMod.qaqc.inspection.detailDescription")}
          actions={
            <>
              <QaqcResultBadge result={i.result} />
              {i.rework_required ? (
                <Badge className="bg-destructive/10 text-destructive">{t("fieldMod.qaqc.inspection.reworkBadge")}</Badge>
              ) : null}
              <Badge variant="outline" className="capitalize">
                {i.discipline}
              </Badge>
              {i.result === "fail" ? (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/qaqc/ncrs/new"
                    search={{
                      projectId: i.project_id,
                      source: "inspection",
                      sourceId: i.id,
                      discipline: i.discipline,
                      area: i.area ?? undefined,
                    }}
                  >
                    {t("fieldMod.qaqc.inspection.raiseNcr")}
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
        <span className="text-xs text-muted-foreground">
          {i.project_name ?? "—"} · {i.inspection_date}
        </span>
      </div>

      {updateMut.isError && errorCodeOf(updateMut.error) === "hold_point_open" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t("fieldMod.qaqc.holdPoint.open")}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("fieldMod.qaqc.inspection.inspectionSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.discipline")}</Label>
            <Select
              value={discipline}
              onValueChange={(v) => setDiscipline(v as QaqcDiscipline)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QAQC_DISCIPLINES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {QAQC_DISCIPLINE_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.area")}</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.itpReference")}</Label>
            <Input value={itpRef} onChange={(e) => setItpRef(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.inspectionDate")}</Label>
            <Input
              type="date"
              value={inspectionDate}
              onChange={(e) => setInspectionDate(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.result")}</Label>
            <Select
              value={result}
              onValueChange={(v) => setResult(v as QaqcResult)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QAQC_RESULTS.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="text-sm font-medium">{t("fieldMod.qaqc.inspection.reworkRequired")}</div>
            <Switch
              checked={reworkRequired}
              onCheckedChange={setReworkRequired}
              disabled={!canEdit}
            />
          </div>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label>{t("fieldMod.qaqc.inspection.reworkNotes")}{reworkRequired ? " *" : ""}</Label>
            <Textarea
              rows={3}
              value={reworkNotes}
              onChange={(e) => setReworkNotes(e.target.value)}
              disabled={!canEdit}
            />
            {clientReworkError ? (
              <span className="text-xs text-destructive">{clientReworkError}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("fieldMod.qaqc.inspection.attachments")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AttachmentList
            attachments={attachments}
            onRemove={
              canEdit ? (idx) => setAttachments((a) => a.filter((_, i2) => i2 !== idx)) : undefined
            }
          />
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-0 flex gap-2 rounded-md border border-border bg-background/95 p-3 backdrop-blur">
          <Button
            type="button"
            onClick={() => updateMut.mutate()}
            disabled={updateMut.isPending || !!clientReworkError}
            className="ml-auto"
          >
            <Save size={14} aria-hidden />
            {updateMut.isPending ? t("fieldMod.common.saving") : t("fieldMod.qaqc.inspection.saveChanges")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
