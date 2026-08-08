// GC-16d — Governed calendar policy administration surface.
//
// Operable from the project contracts & claims cockpit (contract override) and
// from company settings (company default). Every mutation is server-governed:
// this component only renders the effective resolution, provenance, impact
// preview and the actions the caller's role permits.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  decideCalendarHolidaySet,
  decideCalendarPolicyChange,
  importCalendarHolidayDates,
  previewCalendarPolicyImpact,
  recalculateContractDeadlines,
  requestCalendarPolicyChange,
  saveCalendarHolidaySet,
} from "@/lib/calendar-governance.functions";
import { calendarGovernanceQueryOptions } from "@/lib/calendar-governance.query";
import type { RecalcPreview } from "@/lib/calendar-governance.rules";
import { costingErrorMessage } from "@/lib/costing.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.calendarPolicy";

export interface CalendarPolicyAdminProps {
  scope: "company" | "contract";
  projectId?: string | undefined;
  contractId?: string | undefined;
  /** Holiday-set maintenance is a company-level surface. */
  showHolidaySets?: boolean;
}

/** Parses `YYYY-MM-DD | EN | AR [| kind]` lines into import rows. */
export function parseHolidayLines(text: string): {
  observed_date: string;
  label_en: string;
  label_ar: string;
  kind: "public_holiday" | "exceptional_closure";
}[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [date = "", en = "", ar = "", kind = "public_holiday"] = line
        .split("|")
        .map((p) => p.trim());
      return {
        observed_date: date,
        label_en: en,
        label_ar: ar,
        kind: kind === "exceptional_closure" ? "exceptional_closure" : "public_holiday",
      } as const;
    });
}

export function CalendarPolicyAdmin({
  scope,
  projectId,
  contractId,
  showHolidaySets = false,
}: CalendarPolicyAdminProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useMemo(
    () => ({
      ...(projectId ? { project_id: projectId } : {}),
      ...(contractId ? { contract_id: contractId } : {}),
    }),
    [projectId, contractId],
  );
  const { data } = useSuspenseQuery(calendarGovernanceQueryOptions(query));

  const previewFn = useServerFn(previewCalendarPolicyImpact);
  const requestFn = useServerFn(requestCalendarPolicyChange);
  const decideFn = useServerFn(decideCalendarPolicyChange);
  const saveSetFn = useServerFn(saveCalendarHolidaySet);
  const importFn = useServerFn(importCalendarHolidayDates);
  const decideSetFn = useServerFn(decideCalendarHolidaySet);
  const recalcFn = useServerFn(recalculateContractDeadlines);

  const [target, setTarget] = useState<string>(data.resolution?.calendar_id ?? "iso-std");
  const [timezone, setTimezone] = useState<string>(data.resolution?.timezone ?? "UTC");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RecalcPreview | null>(null);

  const [setForm, setSetForm] = useState({
    calendar_id: "mena-jo",
    jurisdiction: "Jordan",
    year: new Date().getUTCFullYear(),
    version: "1",
    label: "",
    source_reference: "",
  });
  const [importSetId, setImportSetId] = useState<string>("");
  const [importText, setImportText] = useState("");
  const [importIssues, setImportIssues] = useState<string[]>([]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["calendar-governance"] });
  const fail = (e: unknown) => toast.error(costingErrorMessage(e));

  const timezones =
    data.calendars.find((c) => c.id === target)?.timezones ?? (["UTC"] as readonly string[]);

  const previewMut = useMutation({
    mutationFn: () =>
      previewFn({
        data: {
          scope,
          to_calendar_id: target as never,
          contract_id: contractId ?? null,
          project_id: projectId ?? null,
        },
      }),
    onSuccess: (res) => {
      setPreview(res);
      toast.success(t(`${K}.toast.previewed`));
    },
    onError: fail,
  });

  const requestMut = useMutation({
    mutationFn: () =>
      requestFn({
        data: {
          scope,
          to_calendar_id: target as never,
          to_timezone: timezone,
          reason,
          contract_id: contractId ?? null,
          project_id: projectId ?? null,
          idempotency_key: `${scope}:${contractId ?? projectId ?? "company"}:${target}:${timezone}:${reason.slice(0, 24)}`,
        },
      }),
    onSuccess: (res) => {
      toast.success(t(`${K}.toast.${res.status === "applied" ? "applied" : "requested"}`));
      setReason("");
      void invalidate();
    },
    onError: fail,
  });

  const decideMut = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject"; row_version: number }) =>
      decideFn({ data: v }),
    onSuccess: (res) => {
      toast.success(t(`${K}.toast.${res.status === "applied" ? "applied" : "rejected"}`));
      void invalidate();
    },
    onError: fail,
  });

  const recalcMut = useMutation({
    mutationFn: (apply: boolean) =>
      recalcFn({
        data: {
          project_id: projectId!,
          contract_id: contractId ?? null,
          apply,
          ...(apply ? { reason: reason || t(`${K}.actions.recalcApply`) } : {}),
        },
      }),
    onSuccess: (res) => {
      setPreview(res);
      toast.success(t(`${K}.toast.${res.applied ? "recalculated" : "previewed"}`));
      if (res.applied) void invalidate();
    },
    onError: fail,
  });

  const saveSetMut = useMutation({
    mutationFn: () =>
      saveSetFn({
        data: {
          calendar_id: setForm.calendar_id as never,
          jurisdiction: setForm.jurisdiction,
          year: Number(setForm.year),
          version: setForm.version,
          label: setForm.label || `${setForm.jurisdiction} ${setForm.year}`,
          source_reference: setForm.source_reference || null,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.setSaved`));
      void invalidate();
    },
    onError: fail,
  });

  const importMut = useMutation({
    mutationFn: (previewOnly: boolean) =>
      importFn({
        data: { set_id: importSetId, preview: previewOnly, rows: parseHolidayLines(importText) },
      }),
    onSuccess: (res) => {
      setImportIssues(res.issues.map((i) => i.message));
      if (res.preview) toast.success(t(`${K}.toast.previewed`));
      else {
        toast.success(t(`${K}.toast.imported`));
        setImportText("");
        void invalidate();
      }
    },
    onError: fail,
  });

  const decideSetMut = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "supersede"; row_version: number }) =>
      decideSetFn({ data: v }),
    onSuccess: (res) => {
      toast.success(t(`${K}.toast.${res.status === "approved" ? "setApproved" : "setSuperseded"}`));
      void invalidate();
    },
    onError: fail,
  });

  const canRequest = data.access.canRequest;
  const canApprove = data.access.canApprove;

  return (
    <section className="space-y-6" aria-labelledby="calendar-policy-heading">
      <SectionHeader
        id="calendar-policy-heading"
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
      />

      {data.resolution_error ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertTitle>{t(`${K}.invalid`)}</AlertTitle>
          <AlertDescription>{data.resolution_error.message}</AlertDescription>
        </Alert>
      ) : null}

      {!data.coverage.ok ? (
        <Alert>
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertTitle>{t(`${K}.coverageMissing`)}</AlertTitle>
          <AlertDescription>{data.coverage.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* Effective resolution ------------------------------------------- */}
      <Card className="p-4">
        <h3 className="text-sm font-medium">{t(`${K}.effective`)}</h3>
        {data.resolution ? (
          <>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">{t(`${K}.calendar`)}</dt>
                <dd className="text-sm font-medium">{data.resolution.calendar_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t(`${K}.calendarVersion`)}</dt>
                <dd className="text-sm font-medium">{data.resolution.calendar_version}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t(`${K}.timezone`)}</dt>
                <dd className="text-sm font-medium">{data.resolution.timezone}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t(`${K}.validation`)}</dt>
                <dd className="text-sm font-medium">
                  <StatusBadge status={data.coverage.ok ? "approved" : "pending"}>
                    {data.coverage.ok ? t(`${K}.valid`) : t(`${K}.coverageMissing`)}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
            <Table className="mt-4">
              <caption className="sr-only">{t(`${K}.chain`)}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.chain`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.calendar`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.timezone`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.applied`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.resolution.chain.map((step) => (
                  <TableRow key={step.source}>
                    <TableCell>{t(`${K}.source.${step.source}`)}</TableCell>
                    <TableCell>{step.calendar_id ?? t(`${K}.notSet`)}</TableCell>
                    <TableCell>{step.timezone ?? t(`${K}.notSet`)}</TableCell>
                    <TableCell>
                      {step.applied ? (
                        <CheckCircle2 className="size-4 text-primary" aria-label={t(`${K}.applied`)} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {t(`${K}.holidaySetVersions`)}:{" "}
              {data.resolution.holiday_set_versions.length
                ? data.resolution.holiday_set_versions.join(", ")
                : t(`${K}.notSet`)}
            </p>
          </>
        ) : (
          <EmptyState icon={CalendarClock} title={t(`${K}.invalid`)} />
        )}
      </Card>

      {/* Policy change --------------------------------------------------- */}
      <Card className="p-4">
        <h3 className="text-sm font-medium">{t(`${K}.scope.${scope}`)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t(`${K}.hint.material`)}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cal-target">{t(`${K}.fields.targetCalendar`)}</Label>
            <Select value={target} onValueChange={setTarget} disabled={!canRequest}>
              <SelectTrigger id="cal-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cal-tz">{t(`${K}.fields.targetTimezone`)}</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canRequest}>
              <SelectTrigger id="cal-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="cal-reason">{t(`${K}.fields.reason`)}</Label>
            <Textarea
              id="cal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canRequest}
              rows={2}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => previewMut.mutate()}
            disabled={!canRequest || previewMut.isPending}
          >
            {t(`${K}.actions.preview`)}
          </Button>
          <Button
            onClick={() => requestMut.mutate()}
            disabled={!canRequest || reason.trim().length < 8 || requestMut.isPending}
          >
            {t(`${K}.actions.request`)}
          </Button>
          {projectId ? (
            <>
              <Button
                variant="outline"
                onClick={() => recalcMut.mutate(false)}
                disabled={!canRequest || recalcMut.isPending}
              >
                {t(`${K}.actions.recalcPreview`)}
              </Button>
              <Button
                variant="secondary"
                onClick={() => recalcMut.mutate(true)}
                disabled={!canApprove || reason.trim().length < 8 || recalcMut.isPending}
              >
                {t(`${K}.actions.recalcApply`)}
              </Button>
            </>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(`${K}.hint.frozen`)}</p>
      </Card>

      {/* Impact preview -------------------------------------------------- */}
      <Card className="p-4">
        <h3 className="text-sm font-medium">{t(`${K}.impact`)}</h3>
        {preview && preview.rows.length ? (
          <Table className="mt-3">
            <caption className="sr-only">{t(`${K}.impact`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.table.deadline`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.before`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.after`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.shift`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.state`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell>{r.before_due_date}</TableCell>
                  <TableCell>{r.after_due_date}</TableCell>
                  <TableCell>{r.shift_days}</TableCell>
                  <TableCell>
                    {r.frozen
                      ? `${t(`${K}.state.frozen`)} · ${t(`${K}.frozenReason.${r.frozen_reason}`)}`
                      : r.changed
                        ? t(`${K}.state.changed`)
                        : t(`${K}.state.unchanged`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={CalendarClock} title={t(`${K}.empty.impact`)} />
        )}
      </Card>

      {/* Pending changes ------------------------------------------------- */}
      <Card className="p-4">
        <h3 className="text-sm font-medium">{t(`${K}.pending`)}</h3>
        {data.pending_changes.length ? (
          <Table className="mt-3">
            <caption className="sr-only">{t(`${K}.pending`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.fields.scope`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.from`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.to`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.requested`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
                <TableHead scope="col">{t(`${K}.actions.approve`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pending_changes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{t(`${K}.scope.${c.scope}`)}</TableCell>
                  <TableCell>{c.from_calendar_id ?? t(`${K}.notSet`)}</TableCell>
                  <TableCell>{`${c.to_calendar_id} · ${c.to_timezone}`}</TableCell>
                  <TableCell>{c.requested_at.slice(0, 10)}</TableCell>
                  <TableCell>
                    <StatusBadge status="pending">{t(`${K}.status.${c.status}`)}</StatusBadge>
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap">
                    <Button
                      size="sm"
                      disabled={!canApprove || decideMut.isPending}
                      onClick={() =>
                        decideMut.mutate({
                          id: c.id,
                          decision: "approve",
                          row_version: c.row_version,
                        })
                      }
                    >
                      {t(`${K}.actions.approve`)}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canApprove || decideMut.isPending}
                      onClick={() =>
                        decideMut.mutate({
                          id: c.id,
                          decision: "reject",
                          row_version: c.row_version,
                        })
                      }
                    >
                      {t(`${K}.actions.reject`)}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={CalendarClock} title={t(`${K}.empty.changes`)} />
        )}
      </Card>

      {/* Affected deadlines ---------------------------------------------- */}
      <Card className="p-4">
        <h3 className="text-sm font-medium">{t(`${K}.affected`)}</h3>
        {data.affected_deadlines.length ? (
          <Table className="mt-3">
            <caption className="sr-only">{t(`${K}.affected`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.table.deadline`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.before`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.calendar`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.affected_deadlines.slice(0, 25).map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.label}</TableCell>
                  <TableCell>{d.due_date}</TableCell>
                  <TableCell>{`${d.calendar_id} v${d.calendar_version}`}</TableCell>
                  <TableCell>{d.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={CalendarClock} title={t(`${K}.empty.deadlines`)} />
        )}
      </Card>

      {/* Holiday sets ---------------------------------------------------- */}
      {showHolidaySets ? (
        <Card className="p-4">
          <h3 className="text-sm font-medium">{t(`${K}.holidaySets`)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t(`${K}.hint.observed`)}</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="set-cal">{t(`${K}.calendar`)}</Label>
              <Select
                value={setForm.calendar_id}
                onValueChange={(v) => setSetForm((s) => ({ ...s, calendar_id: v }))}
                disabled={!canApprove}
              >
                <SelectTrigger id="set-cal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.calendars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-jur">{t(`${K}.fields.jurisdiction`)}</Label>
              <Input
                id="set-jur"
                value={setForm.jurisdiction}
                onChange={(e) => setSetForm((s) => ({ ...s, jurisdiction: e.target.value }))}
                disabled={!canApprove}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-year">{t(`${K}.fields.year`)}</Label>
              <Input
                id="set-year"
                type="number"
                value={setForm.year}
                onChange={(e) => setSetForm((s) => ({ ...s, year: Number(e.target.value) }))}
                disabled={!canApprove}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-ver">{t(`${K}.fields.setVersion`)}</Label>
              <Input
                id="set-ver"
                value={setForm.version}
                onChange={(e) => setSetForm((s) => ({ ...s, version: e.target.value }))}
                disabled={!canApprove}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-label">{t(`${K}.fields.label`)}</Label>
              <Input
                id="set-label"
                value={setForm.label}
                onChange={(e) => setSetForm((s) => ({ ...s, label: e.target.value }))}
                disabled={!canApprove}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="set-src">{t(`${K}.fields.sourceRef`)}</Label>
              <Input
                id="set-src"
                value={setForm.source_reference}
                onChange={(e) => setSetForm((s) => ({ ...s, source_reference: e.target.value }))}
                disabled={!canApprove}
              />
            </div>
          </div>
          <div className="mt-3">
            <Button onClick={() => saveSetMut.mutate()} disabled={!canApprove || saveSetMut.isPending}>
              {t(`${K}.actions.newSet`)}
            </Button>
          </div>

          {data.holiday_sets.length ? (
            <Table className="mt-4">
              <caption className="sr-only">{t(`${K}.holidaySets`)}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.calendar`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.fields.year`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.fields.setVersion`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.dates`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.actions.approve`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.holiday_sets.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.calendar_id}</TableCell>
                    <TableCell>{s.year}</TableCell>
                    <TableCell>{s.version}</TableCell>
                    <TableCell>{s.dates.length}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status === "approved" ? "approved" : "pending"}>
                        {t(`${K}.status.${s.status}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setImportSetId(s.id)}
                        disabled={!canApprove || s.status !== "draft"}
                      >
                        {t(`${K}.actions.import`)}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!canApprove || s.status !== "draft" || decideSetMut.isPending}
                        onClick={() =>
                          decideSetMut.mutate({
                            id: s.id,
                            decision: "approve",
                            row_version: s.row_version,
                          })
                        }
                      >
                        {t(`${K}.actions.approveSet`)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canApprove || s.status === "superseded" || decideSetMut.isPending}
                        onClick={() =>
                          decideSetMut.mutate({
                            id: s.id,
                            decision: "supersede",
                            row_version: s.row_version,
                          })
                        }
                      >
                        {t(`${K}.actions.supersedeSet`)}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState icon={CalendarClock} title={t(`${K}.empty.sets`)} />
          )}

          {importSetId ? (
            <div className="mt-4 space-y-2">
              <Label htmlFor="import-rows">{t(`${K}.fields.rows`)}</Label>
              <Textarea
                id="import-rows"
                rows={5}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                disabled={!canApprove}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => importMut.mutate(true)}
                  disabled={!canApprove || !importText.trim() || importMut.isPending}
                >
                  {t(`${K}.actions.previewImport`)}
                </Button>
                <Button
                  onClick={() => importMut.mutate(false)}
                  disabled={!canApprove || !importText.trim() || importMut.isPending}
                >
                  {t(`${K}.actions.import`)}
                </Button>
                <Button variant="ghost" onClick={() => setImportSetId("")}>
                  {t(`${K}.actions.cancel`)}
                </Button>
              </div>
              {importIssues.length ? (
                <ul className="list-disc space-y-1 ps-5 text-xs text-destructive">
                  {importIssues.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
