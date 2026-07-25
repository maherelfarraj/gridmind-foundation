// P-094 — Mobile-first commissioning test execution capture.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardPaste,
  CloudUpload,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { enqueueMutation, subscribe as subscribeQueue } from "@/lib/offline/queue";
import {
  COMMISSIONING_TEST_TYPE_LABELS,
  computeIvSummary,
  getCommissioningTestForExecute,
  recordUtilityWitness,
  reopenCommissioningTest,
  saveCommissioningTestResult,
  type CommissioningIvPoint,
  type CommissioningIvSummary,
  type CommissioningTestDetail,
  type CommissioningTestType,
} from "@/lib/commissioning.functions";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/commissioning/tests/$testId/execute",
)({
  head: () => ({
    meta: [
      { title: "Execute test — GridMind EPC" },
      {
        name: "description",
        content:
          "Capture commissioning test results, IV curves and utility witness signoffs from the field.",
      },
      { property: "og:title", content: "Execute commissioning test" },
      {
        property: "og:description",
        content:
          "Capture commissioning test results, IV curves and utility witness signoffs from the field.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExecuteCommissioningTest,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
function ExecuteCommissioningTest() {
  const { projectId, testId } = Route.useParams();
  const qc = useQueryClient();
  const router = useRouter();

  const query = useQuery({
    queryKey: ["commissioning-test-execute", testId] as const,
    queryFn: () => getCommissioningTestForExecute({ data: { testId } }),
  });

  if (query.isLoading) return <ExecuteSkeleton />;
  if (query.isError) return <ExecuteError onRetry={() => query.refetch()} />;

  const payload = query.data;
  if (!payload || !payload.test) return <NotFoundPanel projectId={projectId} />;

  return (
    <ExecuteBody
      projectId={projectId}
      test={payload.test}
      canExecute={payload.canExecute}
      canReopen={payload.canReopen}
      onChange={() =>
        qc.invalidateQueries({
          queryKey: ["commissioning-test-execute", testId],
        })
      }
      onBoard={() =>
        router.navigate({
          to: "/projects/$projectId/commissioning",
          params: { projectId },
        })
      }
    />
  );
}

function ExecuteBody({
  projectId,
  test,
  canExecute,
  canReopen,
  onChange,
  onBoard,
}: {
  projectId: string;
  test: CommissioningTestDetail;
  canExecute: boolean;
  canReopen: boolean;
  onChange: () => void;
  onBoard: () => void;
}) {
  const readOnly = test.status === "passed" || test.status === "failed";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 pb-32 pt-4 sm:px-6">
      <header className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="w-fit -ml-2 h-9 px-2">
          <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
            <ArrowLeft size={16} aria-hidden />
            Back to board
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">
              {COMMISSIONING_TEST_TYPE_LABELS[test.test_type]}
            </h1>
            <p className="text-sm text-muted-foreground">
              {test.area}
              {test.equipment_ref ? ` · ${test.equipment_ref}` : ""}
              {test.string_ref ? ` · ${test.string_ref}` : ""}
            </p>
          </div>
          <StatusChip status={test.status} />
        </div>
      </header>

      {test.utility_witness_required ? (
        <WitnessBlock test={test} canExecute={canExecute} readOnly={readOnly} onChange={onChange} />
      ) : null}

      <ResultForm
        test={test}
        canExecute={canExecute}
        readOnly={readOnly}
        onSaved={() => {
          onChange();
          onBoard();
        }}
      />

      {readOnly && canReopen ? <ReopenPanel test={test} onDone={onChange} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result form (adaptive by test_type)
// ---------------------------------------------------------------------------
type FailReason = "witness_required" | "generic";

function ResultForm({
  test,
  canExecute,
  readOnly,
  onSaved,
}: {
  test: CommissioningTestDetail;
  canExecute: boolean;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [queued, setQueued] = useState(false);
  const [failure, setFailure] = useState<{
    reason: FailReason;
    message: string;
  } | null>(null);
  const submitStatusRef = useRef<"passed" | "failed">("passed");

  // Existing (persisted) result seeds the form so re-open + edit works.
  const initial = test.result ?? {};

  // ---- shared fields
  const [notes, setNotes] = useState<string>(
    typeof initial.notes === "string" ? initial.notes : (test.notes ?? ""),
  );

  // ---- IR
  const [irVoltage, setIrVoltage] = useState<string>(numToStr(initial.testVoltageVdc));
  const [irMohm, setIrMohm] = useState<string>(numToStr(initial.measuredMohm));
  const [irAmbient, setIrAmbient] = useState<string>(numToStr(initial.ambientC));
  const [irThreshold, setIrThreshold] = useState<string>(
    numToStr(initial.passThresholdMohm) || "1",
  );

  // ---- Hipot
  const [hipotKv, setHipotKv] = useState<string>(numToStr(initial.testVoltageKv));
  const [hipotSec, setHipotSec] = useState<string>(numToStr(initial.durationS));
  const [hipotLeak, setHipotLeak] = useState<string>(numToStr(initial.leakageMa));
  const [hipotBreak, setHipotBreak] = useState<boolean>(Boolean(initial.breakdown));

  // ---- Continuity / earth / functional / other
  const [measuredValue, setMeasuredValue] = useState<string>(numToStr(initial.measuredValue));
  const [measuredUnit, setMeasuredUnit] = useState<string>(
    typeof initial.unit === "string" ? initial.unit : defaultUnit(test.test_type),
  );

  // ---- String test
  const [strings, setStrings] = useState<
    Array<{
      label: string;
      vocV: string;
      iscA: string;
      polarityOk: boolean;
      passed: boolean;
    }>
  >(() => {
    const arr = Array.isArray(initial.strings) ? initial.strings : [];
    if (arr.length === 0)
      return [{ label: "String 1", vocV: "", iscA: "", polarityOk: true, passed: true }];
    return arr.map((s: any, i: number) => ({
      label: String(s.label ?? `String ${i + 1}`),
      vocV: numToStr(s.vocV),
      iscA: numToStr(s.iscA),
      polarityOk: Boolean(s.polarityOk),
      passed: Boolean(s.passed),
    }));
  });

  // ---- IV curve
  const [ivPoints, setIvPoints] = useState<Array<{ voltageV: string; currentA: string }>>(() => {
    const arr = Array.isArray(initial.iv_points) ? initial.iv_points : [];
    if (arr.length === 0)
      return [
        { voltageV: "", currentA: "" },
        { voltageV: "", currentA: "" },
      ];
    return arr.map((p: any) => ({
      voltageV: numToStr(p.voltageV),
      currentA: numToStr(p.currentA),
    }));
  });

  const ivSummary: CommissioningIvSummary | null = useMemo(() => {
    if (test.test_type !== "iv_curve") return null;
    const numeric: CommissioningIvPoint[] = ivPoints
      .map((p) => ({
        voltageV: Number(p.voltageV),
        currentA: Number(p.currentA),
      }))
      .filter((p) => Number.isFinite(p.voltageV) && Number.isFinite(p.currentA));
    return computeIvSummary(numeric);
  }, [ivPoints, test.test_type]);

  function buildResult(): Record<string, unknown> {
    switch (test.test_type) {
      case "insulation_resistance":
        return {
          testVoltageVdc: numOrNull(irVoltage),
          measuredMohm: numOrNull(irMohm),
          ambientC: numOrNull(irAmbient),
          passThresholdMohm: numOrNull(irThreshold),
        };
      case "hipot":
        return {
          testVoltageKv: numOrNull(hipotKv),
          durationS: numOrNull(hipotSec),
          leakageMa: numOrNull(hipotLeak),
          breakdown: hipotBreak,
        };
      case "iv_curve": {
        const points = ivPoints
          .map((p) => ({
            voltageV: Number(p.voltageV),
            currentA: Number(p.currentA),
          }))
          .filter((p) => Number.isFinite(p.voltageV) && Number.isFinite(p.currentA));
        return { iv_points: points, summary: ivSummary };
      }
      case "string_test":
        return {
          strings: strings.map((s) => ({
            label: s.label,
            vocV: numOrNull(s.vocV),
            iscA: numOrNull(s.iscA),
            polarityOk: s.polarityOk,
            passed: s.passed,
          })),
        };
      default:
        return {
          measuredValue: numOrNull(measuredValue),
          unit: measuredUnit,
        };
    }
  }

  const mutation = useMutation({
    mutationFn: async (status: "passed" | "failed") => {
      submitStatusRef.current = status;
      const result = buildResult();
      const clientIdempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `k-${Date.now()}`;
      const payload = {
        testId: test.id,
        status,
        result,
        notes: notes || null,
        clientIdempotencyKey,
      };
      try {
        return await saveCommissioningTestResult({ data: payload });
      } catch (err) {
        if (isOfflineError(err)) {
          await enqueueMutation({
            entity: "commissioning",
            action: "save_result",
            payload,
            clientIdempotencyKey,
          });
          return { queued: true as const };
        }
        throw err;
      }
    },
    onSuccess: (data) => {
      setFailure(null);
      if ((data as any)?.queued) {
        setQueued(true);
        toast.success("Saved offline — will sync when back online");
      } else {
        toast.success(
          submitStatusRef.current === "passed" ? "Test marked passed" : "Test marked failed",
        );
        onSaved();
      }
    },
    onError: (err: unknown) => {
      const parsed = parseHttpError(err);
      setFailure(parsed);
      toast.error(parsed.message);
    },
  });

  // Sonner + banner clear when queue drains.
  useEffect(() => {
    if (!queued) return;
    return subscribeQueue((e) => {
      if (e.type === "synced") {
        setQueued(false);
        toast.success("Queued test result synced");
        onSaved();
      }
    });
  }, [queued, onSaved]);

  const disabled = !canExecute || readOnly || mutation.isPending;

  return (
    <>
      <Card className="border-border bg-card p-4">
        {failure ? (
          <Alert variant="destructive" className="mb-4 border-destructive/40 bg-destructive/10">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>
              {failure.reason === "witness_required" ? "Utility witness required" : "Couldn’t save"}
            </AlertTitle>
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
        ) : null}
        {queued ? (
          <Alert className="mb-4 border-warning/40 bg-warning/10">
            <WifiOff className="h-4 w-4" aria-hidden />
            <AlertTitle>Saved offline</AlertTitle>
            <AlertDescription>
              Your test result is queued and will sync automatically when you’re back online.
            </AlertDescription>
          </Alert>
        ) : null}

        {test.test_type === "insulation_resistance" ? (
          <FieldGrid>
            <TextField
              id="ir-volt"
              label="Test voltage (V DC)"
              type="number"
              step="1"
              value={irVoltage}
              onChange={setIrVoltage}
              disabled={disabled}
            />
            <TextField
              id="ir-mohm"
              label="Measured (MΩ)"
              type="number"
              step="0.01"
              value={irMohm}
              onChange={setIrMohm}
              disabled={disabled}
            />
            <TextField
              id="ir-amb"
              label="Ambient (°C)"
              type="number"
              step="0.1"
              value={irAmbient}
              onChange={setIrAmbient}
              disabled={disabled}
            />
            <TextField
              id="ir-thr"
              label="Pass threshold (MΩ)"
              type="number"
              step="0.01"
              value={irThreshold}
              onChange={setIrThreshold}
              disabled={disabled}
            />
          </FieldGrid>
        ) : null}

        {test.test_type === "hipot" ? (
          <FieldGrid>
            <TextField
              id="hp-kv"
              label="Test voltage (kV)"
              type="number"
              step="0.1"
              value={hipotKv}
              onChange={setHipotKv}
              disabled={disabled}
            />
            <TextField
              id="hp-sec"
              label="Duration (s)"
              type="number"
              step="1"
              value={hipotSec}
              onChange={setHipotSec}
              disabled={disabled}
            />
            <TextField
              id="hp-leak"
              label="Leakage current (mA)"
              type="number"
              step="0.001"
              value={hipotLeak}
              onChange={setHipotLeak}
              disabled={disabled}
            />
            <div className="col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Breakdown observed</p>
                <p className="text-xs text-muted-foreground">
                  If yes, this test must be marked failed.
                </p>
              </div>
              <Switch checked={hipotBreak} onCheckedChange={setHipotBreak} disabled={disabled} />
            </div>
          </FieldGrid>
        ) : null}

        {test.test_type === "string_test" ? (
          <div className="flex flex-col gap-3">
            {strings.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/30 p-3"
              >
                <div className="col-span-2 flex items-center gap-2">
                  <Input
                    className="h-11"
                    value={s.label}
                    onChange={(e) =>
                      setStrings((prev) =>
                        prev.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)),
                      )
                    }
                    disabled={disabled}
                    placeholder={`String ${i + 1}`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setStrings((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={disabled || strings.length === 1}
                    aria-label="Remove string"
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
                <TextField
                  id={`str-voc-${i}`}
                  label="Voc (V)"
                  type="number"
                  step="0.01"
                  value={s.vocV}
                  onChange={(v) =>
                    setStrings((prev) => prev.map((r, idx) => (idx === i ? { ...r, vocV: v } : r)))
                  }
                  disabled={disabled}
                />
                <TextField
                  id={`str-isc-${i}`}
                  label="Isc (A)"
                  type="number"
                  step="0.01"
                  value={s.iscA}
                  onChange={(v) =>
                    setStrings((prev) => prev.map((r, idx) => (idx === i ? { ...r, iscA: v } : r)))
                  }
                  disabled={disabled}
                />
                <label className="col-span-1 flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span>Polarity OK</span>
                  <Switch
                    checked={s.polarityOk}
                    onCheckedChange={(v) =>
                      setStrings((prev) =>
                        prev.map((r, idx) => (idx === i ? { ...r, polarityOk: v } : r)),
                      )
                    }
                    disabled={disabled}
                  />
                </label>
                <label className="col-span-1 flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span>Passed</span>
                  <Switch
                    checked={s.passed}
                    onCheckedChange={(v) =>
                      setStrings((prev) =>
                        prev.map((r, idx) => (idx === i ? { ...r, passed: v } : r)),
                      )
                    }
                    disabled={disabled}
                  />
                </label>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setStrings((prev) => [
                  ...prev,
                  {
                    label: `String ${prev.length + 1}`,
                    vocV: "",
                    iscA: "",
                    polarityOk: true,
                    passed: true,
                  },
                ])
              }
              disabled={disabled}
            >
              <Plus size={14} aria-hidden />
              Add string
            </Button>
          </div>
        ) : null}

        {test.test_type === "iv_curve" ? (
          <IvCurveEditor
            points={ivPoints}
            onChange={setIvPoints}
            summary={ivSummary}
            disabled={disabled}
          />
        ) : null}

        {test.test_type === "continuity" ||
        test.test_type === "earth_resistance" ||
        test.test_type === "functional" ||
        test.test_type === "other" ? (
          <FieldGrid>
            <TextField
              id="mv"
              label="Measured value"
              type="number"
              step="0.001"
              value={measuredValue}
              onChange={setMeasuredValue}
              disabled={disabled}
            />
            <TextField
              id="mu"
              label="Unit"
              value={measuredUnit}
              onChange={setMeasuredUnit}
              disabled={disabled}
            />
          </FieldGrid>
        ) : null}

        <div className="mt-4 grid gap-2">
          <Label htmlFor="notes" className="text-sm">
            Notes
          </Label>
          <Textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
          />
        </div>
      </Card>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-2">
          {!canExecute ? (
            <span className="mr-auto text-xs text-muted-foreground">
              You don’t have permission to execute this test.
            </span>
          ) : readOnly ? (
            <span className="mr-auto text-xs text-muted-foreground">
              Test completed — re-open to edit.
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 min-w-24"
            disabled={disabled}
            onClick={() => mutation.mutate("failed")}
          >
            {mutation.isPending && submitStatusRef.current === "failed" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : null}
            Mark failed
          </Button>
          <Button
            type="button"
            className="h-11 min-w-24"
            disabled={disabled}
            onClick={() => mutation.mutate("passed")}
          >
            {mutation.isPending && submitStatusRef.current === "passed" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : null}
            Mark passed
          </Button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// IV curve editor
// ---------------------------------------------------------------------------
function IvCurveEditor({
  points,
  onChange,
  summary,
  disabled,
}: {
  points: Array<{ voltageV: string; currentA: string }>;
  onChange: (p: Array<{ voltageV: string; currentA: string }>) => void;
  summary: CommissioningIvSummary | null;
  disabled: boolean;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const applyPaste = () => {
    const rows = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[,;\t\s]+/).filter(Boolean);
        return {
          voltageV: parts[0] ?? "",
          currentA: parts[1] ?? "",
        };
      })
      .filter((r) => r.voltageV && r.currentA);
    if (rows.length === 0) {
      toast.error("No valid V,I rows found");
      return;
    }
    onChange(rows);
    setPasteOpen(false);
    setPasteText("");
    toast.success(`Loaded ${rows.length} points`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">IV points</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen((v) => !v)}
            disabled={disabled}
          >
            <ClipboardPaste size={14} aria-hidden />
            Paste CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...points, { voltageV: "", currentA: "" }])}
            disabled={disabled}
          >
            <Plus size={14} aria-hidden />
            Add row
          </Button>
        </div>
      </div>

      {pasteOpen ? (
        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <Textarea
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"V,I per line\n0,8.2\n10,8.1\n20,8.0"}
            className="font-mono text-xs"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={applyPaste}>
              Apply
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
        <div>Voltage (V)</div>
        <div>Current (A)</div>
        <div />
      </div>
      {points.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input
            className="h-11 font-mono"
            type="number"
            step="0.001"
            inputMode="decimal"
            value={p.voltageV}
            onChange={(e) =>
              onChange(points.map((r, idx) => (idx === i ? { ...r, voltageV: e.target.value } : r)))
            }
            disabled={disabled}
          />
          <Input
            className="h-11 font-mono"
            type="number"
            step="0.001"
            inputMode="decimal"
            value={p.currentA}
            onChange={(e) =>
              onChange(points.map((r, idx) => (idx === i ? { ...r, currentA: e.target.value } : r)))
            }
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(points.filter((_, idx) => idx !== i))}
            disabled={disabled || points.length <= 2}
            aria-label="Remove point"
          >
            <Trash2 size={16} aria-hidden />
          </Button>
        </div>
      ))}

      <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/40 p-3 text-sm sm:grid-cols-4">
        <SummaryStat label="Voc (V)" value={summary?.voc} />
        <SummaryStat label="Isc (A)" value={summary?.isc} />
        <SummaryStat label="Pmax (W)" value={summary?.pmax} />
        <SummaryStat label="Fill factor" value={summary?.ff} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-semibold text-foreground">
        {value == null || Number.isNaN(value) ? "—" : value.toString()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Witness block
// ---------------------------------------------------------------------------
function WitnessBlock({
  test,
  canExecute,
  readOnly,
  onChange,
}: {
  test: CommissioningTestDetail;
  canExecute: boolean;
  readOnly: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const existing = test.witness_file_path && test.utility_witnessed_at;

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Enter the witness name");
      return;
    }
    if (!file) {
      toast.error("Attach the signed form / photo");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Witness upload requires an internet connection");
      return;
    }
    setUploading(true);
    try {
      const uuid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `w-${Date.now()}`;
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const objectPath = `${test.company_id}/witness/${test.project_id}/${test.id}/${uuid}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("closeout").upload(objectPath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;

      await recordUtilityWitness({
        data: {
          testId: test.id,
          witnessName: name.trim(),
          witnessFilePath: objectPath,
          clientIdempotencyKey: uuid,
        },
      });
      toast.success("Witness recorded");
      setName("");
      setFile(null);
      onChange();
    } catch (err) {
      const parsed = parseHttpError(err);
      toast.error(parsed.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="font-display text-base font-semibold text-foreground">
          Utility witness required
        </h2>
      </div>

      {existing ? (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">
            Recorded — {test.utility_witness_name}
          </p>
          <p className="text-xs text-muted-foreground">
            Witnessed at {formatDate(test.utility_witnessed_at)}
          </p>
          <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
            {test.witness_file_path}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No witness recorded yet. Upload the signed form or photo before you can mark this test
          passed.
        </p>
      )}

      {!readOnly && canExecute ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="witness-name">Witness name</Label>
            <Input
              id="witness-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="witness-file">Signed form / photo</Label>
            <Input
              id="witness-file"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="h-11 file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm"
            />
          </div>
          <Button type="button" onClick={submit} disabled={uploading} className="h-11 self-start">
            {uploading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <CloudUpload size={16} aria-hidden />
            )}
            Upload &amp; record
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------
function ReopenPanel({ test, onDone }: { test: CommissioningTestDetail; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: () =>
      reopenCommissioningTest({
        data: {
          testId: test.id,
          clientIdempotencyKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `r-${Date.now()}`,
        },
      }),
    onSuccess: () => {
      toast.success("Test re-opened");
      onDone();
    },
    onError: (err) => toast.error(parseHttpError(err).message),
  });

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">Re-open test</h3>
          <p className="text-sm text-muted-foreground">
            Sets status back to In progress. Audited as{" "}
            <code className="font-mono text-xs">commissioning.test_reopened</code>.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (typeof window !== "undefined" && !window.confirm("Re-open this test?")) return;
            mutation.mutate();
          }}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={14} aria-hidden />
          )}
          Re-open
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small primitives + helpers
// ---------------------------------------------------------------------------
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function TextField({
  id,
  label,
  value,
  onChange,
  disabled,
  type = "text",
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  step?: string;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        step={step}
        inputMode={type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-11 font-mono"
      />
    </div>
  );
}

function StatusChip({ status }: { status: CommissioningTestDetail["status"] }) {
  const tint =
    status === "passed"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : status === "failed"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "in_progress"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
          : status === "scheduled"
            ? "bg-primary/15 text-primary border-primary/30"
            : "bg-secondary text-secondary-foreground border-border";
  return (
    <Badge variant="outline" className={cn("border", tint)}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function ExecuteSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 pt-4 sm:px-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-6 w-72" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ExecuteError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-3 pt-4 sm:px-6">
      <Card className="border-destructive/40 bg-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Couldn’t load this test
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Something went wrong. Please try again.
        </p>
        <Button size="sm" className="mt-3" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden />
          Retry
        </Button>
      </Card>
    </div>
  );
}

function NotFoundPanel({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto max-w-3xl px-3 pt-4 sm:px-6">
      <Card className="border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">Test not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This commissioning test doesn’t exist or you don’t have access to it.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
            <ArrowLeft size={14} aria-hidden />
            Back to board
          </Link>
        </Button>
      </Card>
    </div>
  );
}

// ---- primitives ------------------------------------------------------------
function numToStr(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v;
  return "";
}
function numOrNull(v: string): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function defaultUnit(t: CommissioningTestType): string {
  switch (t) {
    case "continuity":
      return "Ω";
    case "earth_resistance":
      return "Ω";
    default:
      return "";
  }
}
function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  return false;
}
function parseHttpError(err: unknown): {
  reason: FailReason;
  message: string;
} {
  const anyErr = err as any;
  const status: number | undefined =
    typeof anyErr?.status === "number"
      ? anyErr.status
      : typeof anyErr?.statusCode === "number"
        ? anyErr.statusCode
        : undefined;
  let code: string | undefined;
  let msg: string | undefined;
  const body = anyErr?.body ?? anyErr?.responseText;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      code = parsed?.error;
      msg = parsed?.message;
    } catch {
      /* ignore */
    }
  }
  if (status === 409 && code === "witness_required") {
    return {
      reason: "witness_required",
      message: msg ?? "Utility witness record required before this test can be marked passed.",
    };
  }
  return {
    reason: "generic",
    message: msg || anyErr?.message || "Something went wrong",
  };
}
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
