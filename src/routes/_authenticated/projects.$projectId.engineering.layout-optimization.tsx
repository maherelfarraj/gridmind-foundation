// P-163 — Layout optimization scenarios: run, score and compare.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getOptimizationApproval, listLayoutOptimizationRuns } from "@/lib/pv-optimize.functions";
import {
  optimizationApprovalQueryOptions,
  optimizationRunsQueryOptions,
  useApplyOptimizationScenario,
  useChooseCandidate,
  useRunLayoutOptimization,
  useSubmitOptimizationRun,
  type OptimizationRunView,
} from "@/lib/pv-optimize-query";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  OPTIMIZATION_METRICS,
  SCENARIO_LABELS,
  SCENARIO_TYPES,
  presetWeights,
  type LayoutScenarioType,
  type MetricWeights,
  type OptimizationMetric,
} from "@/lib/pv/optimize";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/layout-optimization",
)({
  component: LayoutOptimizationPage,
  head: () => ({
    meta: [
      { title: "Layout optimization — GridMind EPC" },
      {
        name: "description",
        content:
          "Score terrain and civil-aware PV layout scenarios on capacity, grading, cable, road, cost and yield.",
      },
      { property: "og:title", content: "Layout optimization — GridMind EPC" },
      {
        property: "og:description",
        content: "Compare optimization scenarios side by side and apply the approved winner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function formatMetric(metric: OptimizationMetric, value: number): string {
  const digits = metric === "epc_cost" || metric === "capacity" ? 0 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${METRIC_UNITS[metric]}`;
}

function LayoutOptimizationPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listLayoutOptimizationRuns);
  const approvalFn = useServerFn(getOptimizationApproval);

  const runsQuery = useQuery(optimizationRunsQueryOptions(listFn, projectId));
  const runs = runsQuery.data?.runs ?? [];
  const canWrite = runsQuery.data?.canWrite ?? false;

  const [scenario, setScenario] = useState<LayoutScenarioType>("balanced");
  const [name, setName] = useState("Balanced scenario");
  const [weights, setWeights] = useState<MetricWeights>(presetWeights("balanced"));
  const [customWeights, setCustomWeights] = useState(false);
  const [maxGrading, setMaxGrading] = useState("");
  const [minCapacity, setMinCapacity] = useState("");
  const [requireCompliance, setRequireCompliance] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runMutation = useRunLayoutOptimization(projectId);
  const chooseMutation = useChooseCandidate(projectId);
  const submitMutation = useSubmitOptimizationRun(projectId);
  const applyMutation = useApplyOptimizationScenario(projectId);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const approvalQuery = useQuery(
    optimizationApprovalQueryOptions(approvalFn, selectedRun?.id ?? null),
  );
  const approvalStatus = approvalQuery.data?.status ?? null;

  const weightSum = OPTIMIZATION_METRICS.reduce((s, m) => s + weights[m], 0);
  const weightsValid = Math.abs(weightSum - 1) <= 0.01;

  function pickScenario(next: LayoutScenarioType) {
    setScenario(next);
    setName(`${SCENARIO_LABELS[next]} scenario`);
    if (!customWeights) setWeights(presetWeights(next));
  }

  function setWeight(metric: OptimizationMetric, value: number) {
    setCustomWeights(true);
    setWeights((prev) => ({ ...prev, [metric]: Math.round(value * 100) / 100 }));
  }

  const comparison = useMemo(
    () => runs.filter((r) => compareIds.includes(r.id) && r.results?.candidates?.length),
    [runs, compareIds],
  );

  function toggleCompare(run: OptimizationRunView) {
    setCompareIds((prev) =>
      prev.includes(run.id)
        ? prev.filter((id) => id !== run.id)
        : prev.length >= 4
          ? prev
          : [...prev, run.id],
    );
  }

  function winnerOf(run: OptimizationRunView) {
    const index = run.chosen_candidate ?? run.results?.winner_index ?? null;
    return run.results?.candidates.find((c) => c.index === index) ?? null;
  }

  const bestScore = Math.max(0, ...comparison.map((r) => winnerOf(r)?.score ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Layout optimization"
        description="Sweep layout parameters, score every candidate on six metrics and hand the approved winner to the layout."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>New run</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="scenario">Scenario preset</Label>
              <Select value={scenario} onValueChange={(v) => pickScenario(v as LayoutScenarioType)}>
                <SelectTrigger id="scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCENARIO_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SCENARIO_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="run-name">Run name</Label>
              <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>Metric weights</Label>
                <span
                  className={cn(
                    "text-xs",
                    weightsValid ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  Σ {weightSum.toFixed(2)}
                </span>
              </div>
              {OPTIMIZATION_METRICS.map((metric) => (
                <div key={metric} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{METRIC_LABELS[metric]}</span>
                    <span>{weights[metric].toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[weights[metric]]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setWeight(metric, v)}
                    aria-label={`${METRIC_LABELS[metric]} weight`}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCustomWeights(false);
                  setWeights(presetWeights(scenario));
                }}
              >
                Reset to preset
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="max-grading">Max grading (m³)</Label>
                <Input
                  id="max-grading"
                  inputMode="numeric"
                  value={maxGrading}
                  onChange={(e) => setMaxGrading(e.target.value)}
                  placeholder="none"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="min-capacity">Min capacity (kWp)</Label>
                <Input
                  id="min-capacity"
                  inputMode="numeric"
                  value={minCapacity}
                  onChange={(e) => setMinCapacity(e.target.value)}
                  placeholder="none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={requireCompliance}
                onCheckedChange={(v) => setRequireCompliance(v === true)}
              />
              Discard candidates that fail compliance
            </label>

            <Button
              disabled={!canWrite || !weightsValid || runMutation.isPending}
              onClick={() =>
                runMutation.mutate({
                  projectId,
                  name,
                  scenarioType: scenario,
                  weights,
                  constraints: {
                    maxGradingM3: maxGrading ? Number(maxGrading) : null,
                    minCapacityKwp: minCapacity ? Number(minCapacity) : null,
                    requireCompliance,
                  },
                  surfaceId: null,
                })
              }
            >
              {runMutation.isPending ? "Running…" : "Run optimization"}
            </Button>
            {!canWrite ? (
              <p className="text-xs text-muted-foreground">
                Engineering write access is required to start a run.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <EmptyState
                title="No optimization runs yet"
                description="Pick a scenario preset and run the engine to score candidate layouts."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Cmp</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={cn("cursor-pointer", selectedRun?.id === run.id && "bg-muted/50")}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={compareIds.includes(run.id)}
                          onCheckedChange={() => toggleCompare(run)}
                          aria-label={`Compare ${run.run_ref}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {run.run_ref}
                        <span className="block text-xs text-muted-foreground">{run.name}</span>
                      </TableCell>
                      <TableCell>
                        {SCENARIO_LABELS[run.scenario_type as LayoutScenarioType] ??
                          run.scenario_type}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {run.score === null ? "—" : run.score.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(run.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedRun ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedRun.run_ref} · candidates
              {selectedRun.results?.error ? " — failed" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {selectedRun.results?.error ? (
              <p className="text-sm text-destructive">{selectedRun.results.error}</p>
            ) : null}
            {selectedRun.results?.candidates?.length ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      {OPTIMIZATION_METRICS.map((m) => (
                        <TableHead key={m} className="text-right">
                          {METRIC_LABELS[m]}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRun.results.candidates.map((candidate) => (
                      <TableRow
                        key={candidate.index}
                        className={cn(
                          candidate.index === selectedRun.chosen_candidate && "bg-accent/40",
                        )}
                      >
                        <TableCell className="text-xs">
                          {candidate.label}
                          {candidate.excludedReason ? (
                            <span className="block text-destructive">
                              excluded · {candidate.excludedReason}
                            </span>
                          ) : null}
                        </TableCell>
                        {OPTIMIZATION_METRICS.map((m) => (
                          <TableCell key={m} className="text-right tabular-nums text-xs">
                            {formatMetric(m, candidate.metrics[m])}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">
                          {candidate.score.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={
                              !canWrite ||
                              Boolean(candidate.excludedReason) ||
                              selectedRun.status === "approved" ||
                              chooseMutation.isPending
                            }
                            onClick={() =>
                              chooseMutation.mutate({
                                runId: selectedRun.id,
                                candidateIndex: candidate.index,
                              })
                            }
                          >
                            Choose
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    disabled={
                      !canWrite ||
                      selectedRun.chosen_candidate === null ||
                      selectedRun.status === "approved" ||
                      submitMutation.isPending
                    }
                    onClick={() => submitMutation.mutate(selectedRun.id)}
                  >
                    Submit for approval
                  </Button>
                  <Button
                    disabled={!canWrite || approvalStatus !== "approved" || applyMutation.isPending}
                    onClick={() => applyMutation.mutate(selectedRun.id)}
                  >
                    Apply chosen scenario
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Approval: {approvalStatus ?? "not submitted"} — the layout writer stays locked
                    until the approval engine says yes.
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No candidates on this run.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {comparison.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Comparison — {comparison.length} runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  {comparison.map((run) => (
                    <TableHead key={run.id} className="text-right">
                      {run.run_ref}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {SCENARIO_LABELS[run.scenario_type as LayoutScenarioType]}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {OPTIMIZATION_METRICS.map((metric) => (
                  <TableRow key={metric}>
                    <TableCell className="text-sm">{METRIC_LABELS[metric]}</TableCell>
                    {comparison.map((run) => {
                      const candidate = winnerOf(run);
                      return (
                        <TableCell key={run.id} className="text-right tabular-nums text-xs">
                          {candidate ? formatMetric(metric, candidate.metrics[metric]) : "—"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-sm font-medium">Weighted score</TableCell>
                  {comparison.map((run) => {
                    const candidate = winnerOf(run);
                    const isWinner = (candidate?.score ?? -1) >= bestScore;
                    return (
                      <TableCell
                        key={run.id}
                        className={cn(
                          "text-right tabular-nums",
                          isWinner && "font-semibold text-primary",
                        )}
                      >
                        {candidate ? candidate.score.toFixed(3) : "—"}
                        {isWinner ? " ★" : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3">
              {comparison.map((run) => {
                const candidate = winnerOf(run);
                const pct = Math.round((candidate?.score ?? 0) * 100);
                const isWinner = (candidate?.score ?? -1) >= bestScore;
                return (
                  <div key={run.id} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">
                      {run.run_ref}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full", isWinner ? "bg-primary" : "bg-accent")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
