// P-169 — Shared electrical-study workspace: input sheet → calculate → method →
// save → submit → approval → revisions → report. Semantic tokens only.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import {
  AlertTriangle,
  Calculator,
  Download,
  FilePlus2,
  History,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { EaInputSheet } from "@/components/engineering/ea-input-sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCalculator, type CalculatorStudyType } from "@/lib/electrical";
import { coerceValues, defaultsFor, fieldsOf } from "@/lib/ea/form-spec";
import {
  formatValue,
  normalizeAssumptions,
  normalizeWarnings,
  resultSections,
  sortWarnings,
} from "@/lib/ea/present";
import { EA_STUDY_SPECS } from "@/lib/ea/study-types";
import { EA_VALIDATION_DISCLAIMER } from "@/lib/electrical/disclaimer";
import {
  createEaStudyRevision,
  getEaStudy,
  saveEaStudy,
  submitEaStudy,
  syncEaStudyApproval,
  updateEaStudy,
} from "@/lib/ea-studies.functions";
import { exportEaStudyReport } from "@/lib/ea-report.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

type Assumption = { text: string; source: string };

function errorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.trim() === "" ? fallback : message;
}

export function EaValidationNotice({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      <AlertTriangle className="mr-1 inline size-3 align-[-2px]" aria-hidden />
      {EA_VALIDATION_DISCLAIMER}
    </p>
  );
}

export function EaStudyWorkspace({
  projectId,
  studyType,
  studyId,
}: {
  projectId: string;
  studyType: CalculatorStudyType;
  studyId?: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const spec = EA_STUDY_SPECS[studyType];
  const calculator = useMemo(() => getCalculator(studyType), [studyType]);
  const fields = useMemo(() => fieldsOf(calculator.inputSchema), [calculator]);

  const getStudyFn = useServerFn(getEaStudy);
  const saveFn = useServerFn(saveEaStudy);
  const submitFn = useServerFn(submitEaStudy);
  const updateFn = useServerFn(updateEaStudy);
  const reviseFn = useServerFn(createEaStudyRevision);
  const syncFn = useServerFn(syncEaStudyApproval);
  const exportFn = useServerFn(exportEaStudyReport);

  const studyQuery = useQuery({
    queryKey: ["ea-study", studyId],
    enabled: Boolean(studyId),
    placeholderData: keepPreviousData,
    queryFn: () => getStudyFn({ data: { studyId: studyId as string } }),
  });

  const study = studyQuery.data?.study ?? null;
  const readOnly = Boolean(study) && study?.status !== "draft";

  const form = useForm<Record<string, unknown>>({
    defaultValues: defaultsFor(calculator.inputSchema, null),
  });

  const [title, setTitle] = useState("");
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [results, setResults] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<
    Array<{ code: string; severity: string; message: string }>
  >([]);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");

  // Hydrate from the stored record whenever a different revision arrives.
  useEffect(() => {
    if (!study) return;
    form.reset(defaultsFor(calculator.inputSchema, study.input_sheet as Record<string, unknown>));
    setTitle(study.title);
    setAssumptions(normalizeAssumptions(study.assumptions));
    setResults(Object.keys(study.results ?? {}).length > 0 ? study.results : null);
    setWarnings(normalizeWarnings(study.warnings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study?.id, study?.revision, study?.updated_at]);

  const approvalQuery = useQuery({
    queryKey: ["ea-study-approval", studyId],
    enabled: Boolean(studyId) && study?.status === "under_review",
    refetchInterval: 20_000,
    queryFn: () => syncFn({ data: { studyId: studyId as string } }),
  });
  const approval = approvalQuery.data?.approval ?? studyQuery.data?.approval ?? null;

  useEffect(() => {
    if (approvalQuery.data?.changed) {
      void queryClient.invalidateQueries({ queryKey: ["ea-study", studyId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalQuery.data?.changed]);

  function runCalculation(): { inputSheet: Record<string, unknown> } | null {
    const raw = coerceValues(fields, form.getValues());
    const parsed = calculator.inputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(
        t("engMod.ea.workspace.toasts.checkInputSheet", {
          field: issue?.path.join(".") || "input",
          message: issue?.message,
        }),
      );
      return null;
    }
    try {
      const output = calculator.compute(parsed.data);
      setResults(output.results as unknown);
      setWarnings(output.warnings as Array<{ code: string; severity: string; message: string }>);
      setAssumptions(
        (output.assumptionsEcho ?? []).map((a) => ({
          text: `${a.key}: ${a.value}`,
          source: a.source,
        })),
      );
      toast.success(t("engMod.ea.workspace.toasts.calculationComplete"));
      return { inputSheet: raw };
    } catch (err) {
      toast.error(errorMessage(err, t("engMod.ea.workspace.toasts.calculationFailed")));
      return null;
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const raw = coerceValues(fields, form.getValues());
      const parsed = calculator.inputSchema.safeParse(raw);
      if (!parsed.success) throw new Error(t("engMod.ea.workspace.toasts.incompleteInputSheet"));
      const saved = await saveFn({
        data: {
          studyId: studyId ?? null,
          projectId: studyId ? null : projectId,
          studyType,
          title: title.trim() === "" ? `${spec.label} study` : title.trim(),
          inputSheet: raw,
          standardsRef: null,
        },
      });
      if (assumptions.length > 0 && saved.study?.id) {
        await updateFn({ data: { studyId: saved.study.id, assumptions } });
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(t("engMod.ea.workspace.toasts.draftSaved"));
      void queryClient.invalidateQueries({ queryKey: ["ea-studies", projectId] });
      if (!studyId && saved.study?.id) {
        void navigate({
          to: "/projects/$projectId/engineering/studies/$studyId",
          params: { projectId, studyId: saved.study.id },
        });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["ea-study", studyId] });
    },
    onError: (err) => toast.error(errorMessage(err, t("engMod.ea.workspace.toasts.couldNotSave"))),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitFn({ data: { studyId: studyId as string } }),
    onSuccess: () => {
      toast.success(t("engMod.ea.workspace.toasts.submittedForReview"));
      void queryClient.invalidateQueries({ queryKey: ["ea-study", studyId] });
      void queryClient.invalidateQueries({ queryKey: ["ea-studies", projectId] });
    },
    onError: (err) =>
      toast.error(errorMessage(err, t("engMod.ea.workspace.toasts.couldNotSubmit"))),
  });

  const reviseMutation = useMutation({
    mutationFn: () =>
      reviseFn({ data: { studyId: studyId as string, changeSummary: changeSummary.trim() } }),
    onSuccess: () => {
      setReviseOpen(false);
      setChangeSummary("");
      toast.success(t("engMod.ea.workspace.toasts.revisionOpened"));
      void queryClient.invalidateQueries({ queryKey: ["ea-study", studyId] });
    },
    onError: (err) =>
      toast.error(errorMessage(err, t("engMod.ea.workspace.toasts.couldNotOpenRevision"))),
  });

  const exportMutation = useMutation({
    mutationFn: () => exportFn({ data: { studyId: studyId as string } }),
    onSuccess: (res) => {
      toast.success(t("engMod.ea.workspace.toasts.reportStored", { fileName: res.fileName }));
      if (res.signedUrl) window.open(res.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (err) =>
      toast.error(errorMessage(err, t("engMod.ea.workspace.toasts.couldNotExport"))),
  });

  if (studyId && studyQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (studyId && studyQuery.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("engMod.ea.workspace.loadError.title")}
        description={errorMessage(studyQuery.error, t("engMod.ea.workspace.loadError.fallback"))}
        action={
          <Button variant="outline" onClick={() => void studyQuery.refetch()}>
            {t("engMod.common.retry")}
          </Button>
        }
      />
    );
  }

  const sections = resultSections(results);
  const sortedWarnings = sortWarnings(warnings);
  const revisions = studyQuery.data?.revisions ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          study ? `${study.study_number} — ${study.title}` : `New ${spec.label.toLowerCase()} study`
        }
        description={spec.summary}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {study ? <StatusBadge status={study.status} /> : null}
            {study ? (
              <StatusBadge
                status="info"
                tone="neutral"
                label={t("engMod.ea.workspace.rev", { revision: study.revision })}
              />
            ) : null}
            {study ? (
              <Button variant="outline" size="sm" onClick={() => setRevisionsOpen(true)}>
                <History className="mr-1 size-4" aria-hidden /> {t("engMod.ea.workspace.revisions")}
              </Button>
            ) : null}
            {study ? (
              <Button
                variant="outline"
                size="sm"
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                <Download className="mr-1 size-4" aria-hidden />{" "}
                {t("engMod.ea.workspace.exportReport")}
              </Button>
            ) : null}
            {study?.status === "approved" ? (
              <Button size="sm" onClick={() => setReviseOpen(true)}>
                <FilePlus2 className="mr-1 size-4" aria-hidden />{" "}
                {t("engMod.ea.workspace.newRevision")}
              </Button>
            ) : null}
          </div>
        }
      />

      <EaValidationNotice />

      {approval ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <StatusBadge status={approval.status} />
            <span className="text-muted-foreground">
              {t("engMod.ea.workspace.stepOf", {
                current: approval.current_step,
                total: approval.steps.length || 2,
              })}
            </span>
            {approval.sla_due_at ? (
              <span className="text-muted-foreground">
                {t("engMod.ea.workspace.slaDue", {
                  date: new Date(approval.sla_due_at).toLocaleString(),
                })}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">{t("engMod.ea.workspace.inputSheet")}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="ea-title" className="text-xs text-muted-foreground">
              {t("engMod.ea.workspace.titleLabel")}
            </Label>
            <Input
              id="ea-title"
              className="h-9 w-64"
              value={title}
              disabled={readOnly}
              placeholder={`${spec.label} study`}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <EaInputSheet fields={fields} form={form} disabled={readOnly} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button type="button" onClick={() => runCalculation()}>
              <Calculator className="mr-1 size-4" aria-hidden />{" "}
              {t("engMod.ea.workspace.calculate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={readOnly || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="mr-1 size-4" aria-hidden /> {t("engMod.ea.workspace.saveDraft")}
            </Button>
            {study && study.status === "draft" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                <Send className="mr-1 size-4" aria-hidden />{" "}
                {t("engMod.ea.workspace.submitForReview")}
              </Button>
            ) : null}
            {readOnly ? (
              <span className="self-center text-xs text-muted-foreground">
                {study?.status === "approved"
                  ? t("engMod.ea.workspace.approvedNotice")
                  : t("engMod.ea.workspace.underReviewNotice")}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("engMod.ea.workspace.results")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!results ? (
              <EmptyState
                icon={Calculator}
                compact
                title={t("engMod.ea.workspace.noResults.title")}
                description={t("engMod.ea.workspace.noResults.description")}
              />
            ) : (
              <>
                {sections.scalars.length > 0 ? (
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.scalars.map((row) => (
                      <div key={row.label} className="rounded-md border border-border bg-card p-3">
                        <dt className="text-xs text-muted-foreground">{row.label}</dt>
                        <dd className="text-sm font-semibold text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {sections.tables.map((table) => (
                  <div key={table.title} className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">{table.title}</h4>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {table.columns.map((col) => (
                              <TableHead key={col}>{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {table.rows.map((row, i) => (
                            <TableRow key={`${table.title}-${i}`}>
                              {row.map((cell, j) => (
                                <TableCell key={`${table.title}-${i}-${j}`}>{cell}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("engMod.ea.workspace.warnings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedWarnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("engMod.ea.workspace.noWarnings")}</p>
            ) : (
              sortedWarnings.map((w) => (
                <div
                  key={`${w.code}-${w.message}`}
                  className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
                >
                  <StatusBadge status={w.severity} label={w.severity.toUpperCase()} />
                  <span className="text-sm text-muted-foreground">{w.message}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Accordion type="single" collapsible className="rounded-md border border-border bg-card px-4">
        <AccordionItem value="method" className="border-0">
          <AccordionTrigger className="text-sm font-medium">
            {t("engMod.ea.workspace.methodFormulas")}
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="whitespace-pre-line text-sm text-muted-foreground">{calculator.method}</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground">
                  {t("engMod.ea.workspace.assumptions")}
                </h4>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={readOnly}
                  onClick={() => setAssumptions([...assumptions, { text: "", source: "" }])}
                >
                  <Plus className="mr-1 size-3.5" aria-hidden /> {t("engMod.ea.workspace.add")}
                </Button>
              </div>
              {assumptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("engMod.ea.workspace.noAssumptions")}
                </p>
              ) : (
                assumptions.map((a, index) => (
                  <div key={`assumption-${index}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-9 flex-1"
                      value={a.text}
                      disabled={readOnly}
                      aria-label={t("engMod.ea.workspace.assumptionAria", { index: index + 1 })}
                      onChange={(e) => {
                        const next = [...assumptions];
                        next[index] = { ...a, text: e.target.value };
                        setAssumptions(next);
                      }}
                    />
                    <Input
                      className="h-9 w-56"
                      value={a.source}
                      disabled={readOnly}
                      placeholder={t("engMod.ea.workspace.sourcePlaceholder")}
                      aria-label={t("engMod.ea.workspace.assumptionSourceAria", {
                        index: index + 1,
                      })}
                      onChange={(e) => {
                        const next = [...assumptions];
                        next[index] = { ...a, source: e.target.value };
                        setAssumptions(next);
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={readOnly}
                      aria-label={t("engMod.ea.workspace.removeAssumptionAria", {
                        index: index + 1,
                      })}
                      onClick={() => setAssumptions(assumptions.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("engMod.ea.workspace.standardsReferenced", {
                standards: (study?.standards_ref ?? spec.defaultStandards).join(", "),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <EaValidationNotice />

      <Sheet open={revisionsOpen} onOpenChange={setRevisionsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t("engMod.ea.workspace.revisionHistory")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("engMod.ea.workspace.noSnapshots")}
              </p>
            ) : (
              revisions.map((rev) => (
                <div key={rev.id} className="space-y-2 rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {t("engMod.ea.workspace.rev", { revision: rev.revision })}
                    </span>
                    <StatusBadge status={rev.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rev.change_summary ?? t("engMod.ea.workspace.noChangeSummary")} ·{" "}
                    {new Date(rev.created_at).toLocaleString()}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("engMod.ea.workspace.inputs")}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {summarise(rev.input_sheet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("engMod.ea.workspace.results")}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {summarise(rev.results)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("engMod.ea.workspace.openRevisionTitle")}</DialogTitle>
            <DialogDescription>{t("engMod.ea.workspace.openRevisionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ea-change-summary">{t("engMod.ea.workspace.changeSummaryLabel")}</Label>
            <Textarea
              id="ea-change-summary"
              value={changeSummary}
              rows={3}
              onChange={(e) => setChangeSummary(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseOpen(false)}>
              {t("engMod.ea.workspace.cancel")}
            </Button>
            <Button
              disabled={changeSummary.trim().length === 0 || reviseMutation.isPending}
              onClick={() => reviseMutation.mutate()}
            >
              {t("engMod.ea.workspace.createRevision")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function summarise(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "—";
  const entries = Object.entries(payload as Record<string, unknown>).slice(0, 6);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} row(s)` : formatValue(v)}`)
    .join(" · ");
}
