// P-266 — Controlled copies tab: issue, recall, print, completeness.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Printer, ShieldCheck, Stamp } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCompanySettings } from "@/lib/company.functions";
import {
  issueControlledCopy,
  listDocumentCopies,
  recallControlledCopy,
  type ControlledCopyRow,
} from "@/lib/controlled-copies.functions";
import {
  holderLabel,
  isRecallDue,
  isRecallOverdue,
  parseDocNotCurrent,
  recallCompleteness,
  type Disposition,
} from "@/lib/controlled-copies.rules";
import type { DocumentRecord } from "@/lib/documents-history.functions";
import {
  buildDocumentControlSheetBytes,
  documentControlSheetFilename,
  type DocumentControlSheetInput,
} from "@/lib/exports/document-control-pdf";
import { downloadBlob } from "@/lib/exports/theme";
import { useI18n } from "@/lib/i18n/locale-provider";

export function ControlledCopiesTab({ record }: { record: DocumentRecord | null | undefined }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const documentId = record?.id ?? "";
  const listFn = useServerFn(listDocumentCopies);
  const issueFn = useServerFn(issueControlledCopy);
  const recallFn = useServerFn(recallControlledCopy);
  const settingsFn = useServerFn(getCompanySettings);

  const copies = useQuery({
    queryKey: ["controlled-copies", documentId],
    queryFn: () => listFn({ data: { documentId } }),
    enabled: Boolean(documentId),
  });
  const settings = useQuery({ queryKey: ["company-settings"], queryFn: () => settingsFn({}) });

  const rows = useMemo(() => copies.data ?? [], [copies.data]);
  const stats = useMemo(() => recallCompleteness(rows), [rows]);

  const [holder, setHolder] = useState("");
  const [location, setLocation] = useState("");
  const [open, setOpen] = useState(false);

  const issue = useMutation({
    mutationFn: () =>
      issueFn({
        data: { documentId, holderName: holder.trim(), location: location.trim() || null },
      }),
    onSuccess: () => {
      setOpen(false);
      setHolder("");
      setLocation("");
      void qc.invalidateQueries({ queryKey: ["controlled-copies", documentId] });
      toast.success(t("engMod.copies.issued"));
    },
    onError: (error) => {
      const stale = parseDocNotCurrent(error);
      if (stale) toast.error(t("engMod.copies.notCurrent"));
      else toast.error((error as Error).message);
    },
  });

  const recall = useMutation({
    mutationFn: (input: { copyId: string; disposition: Disposition }) => recallFn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["controlled-copies", documentId] });
      toast.success(t("engMod.copies.recalled"));
    },
    onError: (error) => toast.error((error as Error).message),
  });

  function print(copy: ControlledCopyRow | null) {
    if (!record) return;
    const company = settings.data?.company;
    const branding = settings.data?.branding;
    const input: DocumentControlSheetInput = {
      company: { name: company?.name ?? "GridMind", legalName: company?.legal_name ?? null },
      branding: {
        primaryColor: branding?.primary_color ?? null,
        accentColor: branding?.accent_color ?? null,
        logoDataUrl: null,
      },
      document: {
        docNumber: record.doc_number,
        title: record.title,
        docType: record.doc_type,
        discipline: record.discipline,
        revision: record.current_revision,
        status: record.status,
        retentionClass: record.retention_class,
        changeSummary: record.change_summary,
      },
      copy: copy
        ? {
            copyNumber: copy.copy_number,
            holder: holderLabel(copy),
            issueDate: copy.issue_date,
            location: copy.location,
            revisionPinned: copy.revision_pinned,
          }
        : null,
    };
    const bytes = buildDocumentControlSheetBytes(input);
    downloadBlob(
      documentControlSheetFilename(input),
      new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    );
  }

  const stale = record?.status === "superseded" || record?.status === "obsolete";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{t("engMod.copies.title")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => print(null)}>
              <Printer className="me-1 size-4" aria-hidden />
              {t("engMod.copies.printUncontrolled")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={stale}>
                  <Stamp className="me-1 size-4" aria-hidden />
                  {t("engMod.copies.issue")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("engMod.copies.issueTitle")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="cc-holder">{t("engMod.copies.holder")}</Label>
                    <Input
                      id="cc-holder"
                      value={holder}
                      onChange={(e) => setHolder(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cc-location">{t("engMod.copies.location")}</Label>
                    <Input
                      id="cc-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => issue.mutate()}
                    disabled={issue.isPending || holder.trim().length === 0}
                  >
                    {t("engMod.copies.issue")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm">
              {t("engMod.copies.completeness", { closed: stats.closed, total: stats.total })}
            </span>
            {stats.recallDue > 0 && (
              <Badge variant="destructive">
                {t("engMod.copies.recallDueCount", { count: stats.recallDue })}
              </Badge>
            )}
          </div>
          <Progress value={Math.round(stats.ratio * 100)} />
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={Stamp}
          title={t("engMod.copies.none")}
          description={t("engMod.copies.noneHint")}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((copy) => (
            <li
              key={copy.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("engMod.copies.copyNo", { n: copy.copy_number })} · {holderLabel(copy)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("engMod.copies.pinned", { rev: copy.revision_pinned })} · {copy.issue_date}
                  {copy.location ? ` · ${copy.location}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={copy.status === "issued" ? "outline" : "secondary"}>
                  {t(`engMod.copies.status.${copy.status}`)}
                </Badge>
                {isRecallOverdue(copy) ? (
                  <Badge variant="destructive">{t("engMod.copies.overdue")}</Badge>
                ) : isRecallDue(copy) ? (
                  <Badge variant="destructive">{t("engMod.copies.recallDue")}</Badge>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => print(copy)}>
                  <Printer className="me-1 size-4" aria-hidden />
                  {t("engMod.copies.print")}
                </Button>
                {copy.status === "issued" && (
                  <RecallControl
                    onRecall={(disposition) => recall.mutate({ copyId: copy.id, disposition })}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecallControl({ onRecall }: { onRecall: (d: Disposition) => void }) {
  const { t } = useI18n();
  return (
    <Select onValueChange={(v) => onRecall(v as Disposition)}>
      <SelectTrigger className="h-8 w-[150px]" aria-label={t("engMod.copies.recall")}>
        <SelectValue placeholder={t("engMod.copies.recall")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="recalled">{t("engMod.copies.status.recalled")}</SelectItem>
        <SelectItem value="returned">{t("engMod.copies.status.returned")}</SelectItem>
        <SelectItem value="destroyed">{t("engMod.copies.status.destroyed")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
