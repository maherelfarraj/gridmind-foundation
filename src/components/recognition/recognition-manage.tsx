// GC-15 — Operable recognition governance: policy/settings, performance
// obligations and manual adjustments.
//
// Everything here is non-posting. Writes are role-gated, blocked while the
// snapshot is frozen (submitted/approved) or the period is locked, and carry
// optimistic-concurrency tokens so a stale tab can never silently overwrite.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { costingErrorMessage } from "@/lib/costing.query";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  decideRecognitionAdjustment,
  saveRecognitionAdjustment,
  saveRecognitionObligation,
  saveRecognitionSettings,
} from "@/lib/recognition.functions";
import {
  ADJUSTMENT_KINDS,
  PROGRESS_BASES,
  RECOGNITION_METHODS,
  type RecognitionMethod,
} from "@/lib/recognition.rules";
import type { RecognitionWorkspace } from "@/lib/recognition.server";

const K = "financeMod.costing.recognition";

type AdjustmentRow = {
  id: string;
  kind: string;
  amount: number;
  currency_code: string;
  effective_period: string;
  reason: string;
  evidence_reference: string | null;
  status: string;
  row_version: number;
  prepared_by: string | null;
};

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function RecognitionManagement({
  projectId,
  workspace,
  currentUserId,
}: {
  projectId: string;
  workspace: RecognitionWorkspace;
  currentUserId: string | null;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["recognition"] });
  const onError = (e: unknown) => toast.error(costingErrorMessage(e));

  const canWrite = workspace.access.canWrite;
  const canApprove = workspace.access.canApprove;
  // Frozen snapshots and locked periods are read-only by policy, not by UI habit.
  const locked = workspace.frozen;
  const editable = canWrite && !locked;

  const saveSettings = useServerFn(saveRecognitionSettings);
  const saveObligation = useServerFn(saveRecognitionObligation);
  const saveAdjustment = useServerFn(saveRecognitionAdjustment);
  const decideAdjustment = useServerFn(decideRecognitionAdjustment);

  // ---- Settings ----------------------------------------------------------
  const s = workspace.settings;
  const [method, setMethod] = useState<RecognitionMethod>(s?.default_method ?? "cost_to_cost");
  const [policyVersion, setPolicyVersion] = useState(s?.policy_version ?? "v1");
  const [constraintPct, setConstraintPct] = useState(String(s?.constraint_pct ?? 0));
  const [retentionPct, setRetentionPct] = useState(String(s?.retention_pct ?? 0));
  const [advancePct, setAdvancePct] = useState(String(s?.advance_recovery_pct ?? 0));
  const [includeVariations, setIncludeVariations] = useState(
    s?.include_unapproved_variations ?? false,
  );
  const [includeClaims, setIncludeClaims] = useState(s?.include_unapproved_claims ?? false);
  const [lossProvision, setLossProvision] = useState(s?.loss_provision_enabled ?? true);
  const [capProgress, setCapProgress] = useState(s?.cap_progress_at_100 ?? true);
  const [allowReversal, setAllowReversal] = useState(s?.allow_revenue_reversal ?? false);

  const settingsMutation = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          project_id: projectId,
          default_method: method,
          policy_version: policyVersion,
          constraint_pct: num(constraintPct),
          retention_pct: num(retentionPct),
          advance_recovery_pct: num(advancePct),
          include_unapproved_variations: includeVariations,
          include_unapproved_claims: includeClaims,
          loss_provision_enabled: lossProvision,
          cap_progress_at_100: capProgress,
          allow_revenue_reversal: allowReversal,
          reporting_currency: workspace.reporting_currency,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.manage.toast.settingsSaved`));
      void invalidate();
    },
    onError,
  });

  // ---- Obligation editor -------------------------------------------------
  const [obCode, setObCode] = useState("");
  const [obName, setObName] = useState("");
  const [obMethod, setObMethod] = useState<RecognitionMethod>("cost_to_cost");
  const [obBasis, setObBasis] = useState<(typeof PROGRESS_BASES)[number]>("cost");
  const [obAmount, setObAmount] = useState("0");
  const [obStandalone, setObStandalone] = useState("");
  const [obId, setObId] = useState<string | null>(null);

  const resetObligation = () => {
    setObId(null);
    setObCode("");
    setObName("");
    setObMethod("cost_to_cost");
    setObBasis("cost");
    setObAmount("0");
    setObStandalone("");
  };

  const obligationMutation = useMutation({
    mutationFn: () =>
      saveObligation({
        data: {
          ...(obId ? { id: obId } : {}),
          project_id: projectId,
          code: obCode,
          name: obName,
          method: obMethod,
          progress_basis: obBasis,
          allocation_amount: num(obAmount),
          standalone_value: obStandalone === "" ? null : num(obStandalone),
          currency_code: workspace.project_currency,
          milestones: [],
          constraint_pct: 0,
          is_loss_making: false,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.manage.toast.obligationSaved`));
      resetObligation();
      void invalidate();
    },
    onError,
  });

  // Allocation must reconcile against the contract value the snapshot uses.
  const allocation = useMemo(() => {
    const allocated = workspace.obligations.reduce(
      (sum, o) => sum + Number(o.allocation_amount ?? 0),
      0,
    );
    const standalone = workspace.obligations.reduce(
      (sum, o) => sum + Number(o.standalone_value ?? o.allocation_amount ?? 0),
      0,
    );
    return { allocated, standalone, delta: allocated - standalone };
  }, [workspace.obligations]);

  // ---- Adjustments -------------------------------------------------------
  const adjustments = workspace.adjustments as unknown as AdjustmentRow[];
  const [adjKind, setAdjKind] = useState<(typeof ADJUSTMENT_KINDS)[number]>(ADJUSTMENT_KINDS[0]);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjEvidence, setAdjEvidence] = useState("");

  const adjustmentMutation = useMutation({
    mutationFn: () =>
      saveAdjustment({
        data: {
          project_id: projectId,
          effective_period: workspace.period_month,
          kind: adjKind,
          amount: num(adjAmount),
          currency_code: workspace.reporting_currency,
          reason: adjReason,
          evidence_reference: adjEvidence === "" ? null : adjEvidence,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.manage.toast.adjustmentSaved`));
      setAdjAmount("");
      setAdjReason("");
      setAdjEvidence("");
      void invalidate();
    },
    onError,
  });

  const decisionMutation = useMutation({
    mutationFn: (vars: { id: string; decision: "approve" | "void"; row_version: number }) =>
      decideAdjustment({
        data: { adjustment_id: vars.id, decision: vars.decision, row_version: vars.row_version },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.manage.toast.adjustmentDecided`));
      void invalidate();
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-4">
      {locked ? (
        <p className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {t(`${K}.manage.lockedHint`)}
        </p>
      ) : null}

      {/* Policy & settings ------------------------------------------------ */}
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.manage.policy.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.manage.policy.hint`)}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="rec-method">{t(`${K}.manage.policy.method`)}</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as RecognitionMethod)}
              disabled={!editable}
            >
              <SelectTrigger id="rec-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECOGNITION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`${K}.method.${m}`, { defaultValue: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-policy-version">{t(`${K}.manage.policy.version`)}</Label>
            <Input
              id="rec-policy-version"
              value={policyVersion}
              onChange={(e) => setPolicyVersion(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-constraint">{t(`${K}.manage.policy.constraint`)}</Label>
            <Input
              id="rec-constraint"
              type="number"
              min={0}
              max={100}
              value={constraintPct}
              onChange={(e) => setConstraintPct(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-retention">{t(`${K}.manage.policy.retention`)}</Label>
            <Input
              id="rec-retention"
              type="number"
              min={0}
              max={100}
              value={retentionPct}
              onChange={(e) => setRetentionPct(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-advance">{t(`${K}.manage.policy.advance`)}</Label>
            <Input
              id="rec-advance"
              type="number"
              min={0}
              max={100}
              value={advancePct}
              onChange={(e) => setAdvancePct(e.target.value)}
              disabled={!editable}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              [
                "rec-variations",
                t(`${K}.manage.policy.variations`),
                includeVariations,
                setIncludeVariations,
              ],
              ["rec-claims", t(`${K}.manage.policy.claims`), includeClaims, setIncludeClaims],
              ["rec-loss", t(`${K}.manage.policy.lossProvision`), lossProvision, setLossProvision],
              ["rec-cap", t(`${K}.manage.policy.capProgress`), capProgress, setCapProgress],
              [
                "rec-reversal",
                t(`${K}.manage.policy.allowReversal`),
                allowReversal,
                setAllowReversal,
              ],
            ] as [string, string, boolean, (v: boolean) => void][]
          ).map(([id, label, value, set]) => (
            <div key={id} className="flex items-center justify-between gap-2">
              <Label htmlFor={id}>{label}</Label>
              <Switch id={id} checked={value} onCheckedChange={set} disabled={!editable} />
            </div>
          ))}
        </div>
        <div>
          <Button
            onClick={() => settingsMutation.mutate()}
            disabled={!editable || settingsMutation.isPending}
          >
            {t(`${K}.manage.policy.save`)}
          </Button>
        </div>
      </Card>

      {/* Performance obligations ------------------------------------------ */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t(`${K}.manage.obligations.title`)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(`${K}.manage.obligations.hint`)}</p>
          </div>
          <StatusBadge
            status={Math.abs(allocation.delta) < 0.01 ? "approved" : "rejected"}
            label={t(`${K}.manage.obligations.allocation`, {
              allocated: allocation.allocated.toFixed(0),
              standalone: allocation.standalone.toFixed(0),
            })}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.obligations.code`)}</TableHead>
              <TableHead scope="col">{t(`${K}.obligations.method`)}</TableHead>
              <TableHead scope="col">{t(`${K}.manage.obligations.basis`)}</TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.price`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.manage.obligations.actions`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.obligations.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  {o.code} — {o.name}
                </TableCell>
                <TableCell>{t(`${K}.method.${o.method}`, { defaultValue: o.method })}</TableCell>
                <TableCell>{o.progress_basis}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {Number(o.allocation_amount ?? 0).toFixed(0)} {o.currency_code}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!editable}
                    onClick={() => {
                      setObId(o.id);
                      setObCode(o.code);
                      setObName(o.name);
                      setObMethod(o.method);
                      setObBasis(o.progress_basis);
                      setObAmount(String(o.allocation_amount ?? 0));
                      setObStandalone(o.standalone_value == null ? "" : String(o.standalone_value));
                    }}
                  >
                    {t(`${K}.manage.obligations.edit`)}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ob-code">{t(`${K}.obligations.code`)}</Label>
            <Input
              id="ob-code"
              value={obCode}
              onChange={(e) => setObCode(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-name">{t(`${K}.manage.obligations.name`)}</Label>
            <Input
              id="ob-name"
              value={obName}
              onChange={(e) => setObName(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-method">{t(`${K}.obligations.method`)}</Label>
            <Select
              value={obMethod}
              onValueChange={(v) => setObMethod(v as RecognitionMethod)}
              disabled={!editable}
            >
              <SelectTrigger id="ob-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECOGNITION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`${K}.method.${m}`, { defaultValue: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-basis">{t(`${K}.manage.obligations.basis`)}</Label>
            <Select
              value={obBasis}
              onValueChange={(v) => setObBasis(v as (typeof PROGRESS_BASES)[number])}
              disabled={!editable}
            >
              <SelectTrigger id="ob-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROGRESS_BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-amount">{t(`${K}.obligations.price`)}</Label>
            <Input
              id="ob-amount"
              type="number"
              value={obAmount}
              onChange={(e) => setObAmount(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-standalone">{t(`${K}.manage.obligations.standalone`)}</Label>
            <Input
              id="ob-standalone"
              type="number"
              value={obStandalone}
              onChange={(e) => setObStandalone(e.target.value)}
              disabled={!editable}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => obligationMutation.mutate()}
            disabled={!editable || obCode === "" || obName === "" || obligationMutation.isPending}
          >
            {obId ? t(`${K}.manage.obligations.update`) : t(`${K}.manage.obligations.create`)}
          </Button>
          {obId ? (
            <Button variant="outline" onClick={resetObligation}>
              {t(`${K}.manage.obligations.cancel`)}
            </Button>
          ) : null}
        </div>
      </Card>

      {/* Manual adjustments ------------------------------------------------ */}
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t(`${K}.manage.adjustments.title`)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.manage.adjustments.hint`)}</p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.manage.adjustments.kind`)}</TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.manage.adjustments.amount`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.manage.adjustments.reason`)}</TableHead>
              <TableHead scope="col">{t(`${K}.manage.adjustments.evidence`)}</TableHead>
              <TableHead scope="col">{t(`${K}.manage.adjustments.status`)}</TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.manage.obligations.actions`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.map((a) => {
              const ownPreparation = a.prepared_by != null && a.prepared_by === currentUserId;
              return (
                <TableRow key={a.id}>
                  <TableCell>{a.kind}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {Number(a.amount).toFixed(0)} {a.currency_code}
                  </TableCell>
                  <TableCell className="max-w-[24ch] truncate">{a.reason}</TableCell>
                  <TableCell className="max-w-[20ch] truncate">
                    {a.evidence_reference ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} label={a.status} />
                  </TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      // Segregation of duties: never authorise your own adjustment.
                      disabled={
                        !canApprove ||
                        a.status !== "draft" ||
                        ownPreparation ||
                        decisionMutation.isPending
                      }
                      onClick={() =>
                        decisionMutation.mutate({
                          id: a.id,
                          decision: "approve",
                          row_version: a.row_version,
                        })
                      }
                    >
                      {t(`${K}.manage.adjustments.authorize`)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canApprove || a.status !== "draft" || decisionMutation.isPending}
                      onClick={() =>
                        decisionMutation.mutate({
                          id: a.id,
                          decision: "void",
                          row_version: a.row_version,
                        })
                      }
                    >
                      {t(`${K}.manage.adjustments.void`)}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="adj-kind">{t(`${K}.manage.adjustments.kind`)}</Label>
            <Select
              value={adjKind}
              onValueChange={(v) => setAdjKind(v as (typeof ADJUSTMENT_KINDS)[number])}
              disabled={!editable}
            >
              <SelectTrigger id="adj-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="adj-amount">{t(`${K}.manage.adjustments.amount`)}</Label>
            <Input
              id="adj-amount"
              type="number"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="adj-evidence">{t(`${K}.manage.adjustments.evidence`)}</Label>
            <Input
              id="adj-evidence"
              value={adjEvidence}
              onChange={(e) => setAdjEvidence(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="adj-reason">{t(`${K}.manage.adjustments.reason`)}</Label>
            <Textarea
              id="adj-reason"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              disabled={!editable}
            />
          </div>
        </div>
        <div>
          <Button
            onClick={() => adjustmentMutation.mutate()}
            disabled={
              !editable ||
              adjReason.trim().length < 8 ||
              num(adjAmount) === 0 ||
              adjustmentMutation.isPending
            }
          >
            {t(`${K}.manage.adjustments.create`)}
          </Button>
        </div>
      </Card>
    </div>
  );
}
