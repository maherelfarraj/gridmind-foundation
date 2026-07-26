// P-157 — PV yield simulation workspace: input sheet → run → results → approval.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, BadgeCheck, GitCompare, Info, Play, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  PvSimulationCompare,
  PvSimulationResults,
  type SimulationRecord,
} from "@/components/engineering/pv-simulation-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPvLayoutWriteAccess } from "@/lib/pv-layout.functions";
import { pvLayoutWriteAccessQueryOptions } from "@/lib/pv-layout-query";
import {
  pvSimulationApprovalQueryOptions,
  pvSimulationPrefillQueryOptions,
  pvSimulationsQueryOptions,
  useRunPvSimulation,
  useSetSimulationBaseline,
  useSubmitPvSimulation,
} from "@/lib/pv-yield-query";
import {
  getPvSimulationApproval,
  getPvSimulationPrefill,
  listPvSimulations,
} from "@/lib/pv-yield.functions";
import { YIELD_DISCLAIMER } from "@/lib/pv/yield-v2";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/pv-simulation",
)({
  component: PvSimulationPage,
  head: () => ({
    meta: [
      { title: "Energy yield simulation — GridMind EPC" },
      {
        name: "description",
        content:
          "Run the GridMind transparent 16-step yield model, review the loss chain and approve the project energy baseline.",
      },
      { property: "og:title", content: "Energy yield simulation — GridMind EPC" },
      {
        property: "og:description",
        content: "Transparent PV loss chain, P-scenarios and approval-gated energy baseline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DEFAULT_EFF_CURVE = [
  { loadFraction: 0.05, effPct: 91 },
  { loadFraction: 0.1, effPct: 95.5 },
  { loadFraction: 0.2, effPct: 97.8 },
  { loadFraction: 0.3, effPct: 98.4 },
  { loadFraction: 0.5, effPct: 98.6 },
  { loadFraction: 0.75, effPct: 98.4 },
  { loadFraction: 1, effPct: 98 },
];

const formSchema = z.object({
  name: z.string().min(1, "Name the run").max(120),
  tiltDeg: z.coerce.number().min(0).max(90),
  azimuthDeg: z.coerce.number().min(-180).max(180),
  albedo: z.coerce.number().min(0).max(1),
  tracker: z.enum(["fixed", "single_axis"]),
  gcr: z.coerce.number().min(0.05).max(0.95),
  arrayDcKwp: z.coerce.number().positive(),
  inverterAcKw: z.coerce.number().positive(),
  moduleNoctC: z.coerce.number().min(20).max(70),
  modulePmaxPctPerC: z.coerce.number().min(-1).max(0),
  mismatchPct: z.coerce.number().min(0).max(20),
  dcWiringLossPct: z.coerce.number().min(0).max(20),
  transformerLossPct: z.coerce.number().min(0).max(10),
  mvCollectionLossPct: z.coerce.number().min(0).max(10),
  gridAvailabilityPct: z.coerce.number().min(0).max(100),
  plantAvailabilityPct: z.coerce.number().min(0).max(100),
  gridLimitKw: z.string(),
  degradationYear1Pct: z.coerce.number().min(0).max(20),
  auxiliaryLoadKw: z.coerce.number().min(0),
  bessEnabled: z.boolean(),
  bessRoundTripPct: z.coerce.number().min(50).max(100),
  bessThroughputFraction: z.coerce.number().min(0).max(1),
  sigmaPct: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

type Prefill = Awaited<ReturnType<typeof getPvSimulationPrefill>>;

function defaultsFrom(prefill: Prefill | undefined, runIndex: number): FormValues {
  return {
    name: `Yield run ${runIndex}`,
    tiltDeg: prefill?.siteConfig.tiltDeg ?? 25,
    azimuthDeg: prefill?.siteConfig.azimuthDeg ?? 0,
    albedo: prefill?.siteConfig.albedo ?? 0.2,
    tracker: prefill?.siteConfig.tracker ?? "fixed",
    gcr: prefill?.layout.gcr ?? 0.35,
    arrayDcKwp: prefill?.layout.arrayDcKwp || 1000,
    inverterAcKw: prefill?.stringing.inverterAcKw || 800,
    moduleNoctC: 45,
    modulePmaxPctPerC: -0.34,
    mismatchPct: 1.5,
    dcWiringLossPct: prefill?.stringing.dcWiringLossPct ?? 1.2,
    transformerLossPct: 1,
    mvCollectionLossPct: 0.6,
    gridAvailabilityPct: 99.5,
    plantAvailabilityPct: 99,
    gridLimitKw:
      prefill?.siteConfig.gridLimitKw === null || prefill?.siteConfig.gridLimitKw === undefined
        ? ""
        : String(prefill.siteConfig.gridLimitKw),
    degradationYear1Pct: 2,
    auxiliaryLoadKw: 25,
    bessEnabled: Boolean(prefill?.bess.configured),
    bessRoundTripPct: 88,
    bessThroughputFraction: 0.15,
    sigmaPct: "",
  };
}

/** Persistent, non-dismissible model disclaimer. */
function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{YIELD_DISCLAIMER}</span>
    </div>
  );
}

function SourceTag({ source, overridden }: { source?: string; overridden?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {source ? (
        <span className="font-mono text-[10px] text-muted-foreground">{source}</span>
      ) : null}
      {overridden ? (
        <Badge variant="outline" className="h-4 px-1 text-[10px]">
          overridden
        </Badge>
      ) : null}
    </span>
  );
}

function NumberField({
  label,
  source,
  overridden,
  ...rest
}: {
  label: string;
  source?: string;
  overridden?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs" htmlFor={rest.name}>
          {label}
        </Label>
        <SourceTag source={source} overridden={overridden} />
      </div>
      <Input id={rest.name} type="number" step="any" {...rest} />
    </div>
  );
}

function PvSimulationPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listPvSimulations);
  const prefillFn = useServerFn(getPvSimulationPrefill);
  const approvalFn = useServerFn(getPvSimulationApproval);
  const accessFn = useServerFn(getPvLayoutWriteAccess);

  const access = useQuery(pvLayoutWriteAccessQueryOptions(accessFn));
  const sims = useQuery(pvSimulationsQueryOptions(listFn, projectId));
  const prefill = useQuery(pvSimulationPrefillQueryOptions(prefillFn, projectId));

  const canWrite = Boolean(access.data?.canWrite);
  const simulations = (sims.data?.simulations ?? []) as unknown as SimulationRecord[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);

  const selected = useMemo(
    () => simulations.find((s) => s.id === selectedId) ?? simulations[0] ?? null,
    [simulations, selectedId],
  );
  const compare = useMemo(
    () => simulations.find((s) => s.id === compareId) ?? null,
    [simulations, compareId],
  );

  const approval = useQuery(pvSimulationApprovalQueryOptions(approvalFn, selected?.id ?? null));

  const run = useRunPvSimulation(projectId);
  const submit = useSubmitPvSimulation(projectId);
  const baseline = useSetSimulationBaseline(projectId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as never,
    defaultValues: defaultsFrom(undefined, 1),
  });

  const pf = prefill.data;
  useEffect(() => {
    if (pf) form.reset(defaultsFrom(pf, simulations.length + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf]);

  const values = form.watch();
  const base = useMemo(() => defaultsFrom(pf, simulations.length + 1), [pf, simulations.length]);
  const isOverridden = (key: keyof FormValues) => String(values[key]) !== String(base[key]);
  const sources = pf?.sources ?? {};

  function onSubmit(v: FormValues) {
    if (!pf) return;
    const sigma = v.sigmaPct.trim() === "" ? null : Number(v.sigmaPct);
    const overrides = (Object.keys(base) as Array<keyof FormValues>).filter((k) => isOverridden(k));
    run.mutate({
      projectId,
      layoutId: pf.layout.id,
      siteConfigId: pf.siteConfig.id,
      name: v.name,
      input: {
        latitudeDeg: pf.siteConfig.latitudeDeg,
        tiltDeg: v.tiltDeg,
        azimuthDeg: v.azimuthDeg,
        albedo: v.albedo,
        tracker: v.tracker === "single_axis" ? { type: "single_axis", maxAngleDeg: 55 } : null,
        gcr: v.gcr,
        monthlyGhiKwhM2: pf.siteConfig.monthlyGhiKwhM2,
        monthlyAmbientTempC: pf.siteConfig.monthlyAmbientTempC,
        monthlyDiffuseFraction: null,
        monthlySoilingPct: pf.siteConfig.monthlySoilingPct,
        arrayDcKwp: v.arrayDcKwp,
        inverterAcKw: v.inverterAcKw,
        modulePmaxPctPerC: v.modulePmaxPctPerC,
        moduleNoctC: v.moduleNoctC,
        degradationYear1Pct: v.degradationYear1Pct,
        mismatchPct: v.mismatchPct,
        dcWiringLossPct: v.dcWiringLossPct,
        inverterEffCurve: DEFAULT_EFF_CURVE,
        transformerLossPct: v.transformerLossPct,
        mvCollectionLossPct: v.mvCollectionLossPct,
        gridAvailabilityPct: v.gridAvailabilityPct,
        plantAvailabilityPct: v.plantAvailabilityPct,
        gridLimitKw: v.gridLimitKw.trim() === "" ? null : Number(v.gridLimitKw),
        auxiliaryLoadKw: v.auxiliaryLoadKw,
        bess: v.bessEnabled
          ? {
              roundTripEffPct: v.bessRoundTripPct,
              throughputFraction: v.bessThroughputFraction,
              libraryId: null,
            }
          : null,
        interannualVariabilitySigmaPct: sigma,
        inputSources: {
          ...sources,
          overridden_fields: overrides.length > 0 ? overrides.join(",") : "none",
        },
      },
    });
  }

  const instance = approval.data?.instance ?? null;
  const isApproved = instance?.status === "approved";

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        title="Energy yield simulation"
        description="Transparent 16-step loss chain, P-scenarios and the approval-gated project energy baseline."
      />
      <DisclaimerBanner />

      {prefill.isLoading || sims.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : prefill.isError || sims.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load the simulation workspace"
          description="Refresh the page or check that the project has an active site configuration."
        />
      ) : (
        <Tabs defaultValue="inputs">
          <TabsList>
            <TabsTrigger value="inputs">Input sheet</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="approval">Review &amp; approve</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>

          <TabsContent value="inputs" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="size-4" aria-hidden /> Server-prefilled inputs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Site configuration</p>
                    <p className="font-medium">{pf?.siteConfig.name ?? "No active site config"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Approved layout</p>
                    <p className="font-medium">
                      {pf?.layout.name ?? "None approved"}{" "}
                      {pf?.layout.layoutNumber ? `(${pf.layout.layoutNumber})` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Stringing (P-154)</p>
                    <p className="font-medium">
                      {pf?.stringing.stringCount ?? 0} strings · {pf?.stringing.dcAcRatio ?? "—"}{" "}
                      DC/AC
                    </p>
                  </div>
                </div>

                <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs">
                      Run name
                    </Label>
                    <Input id="name" {...form.register("name")} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <NumberField
                      label="Tilt (°)"
                      source={sources.tilt_deg}
                      overridden={isOverridden("tiltDeg")}
                      {...form.register("tiltDeg")}
                    />
                    <NumberField
                      label="Azimuth (° from south)"
                      source={sources.azimuth_deg}
                      overridden={isOverridden("azimuthDeg")}
                      {...form.register("azimuthDeg")}
                    />
                    <NumberField
                      label="Albedo"
                      source={sources.albedo}
                      overridden={isOverridden("albedo")}
                      {...form.register("albedo")}
                    />
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <Label className="text-xs">Mounting</Label>
                        <SourceTag source={sources.tracker} overridden={isOverridden("tracker")} />
                      </div>
                      <Select
                        value={values.tracker}
                        onValueChange={(v) =>
                          form.setValue("tracker", v as FormValues["tracker"], {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed tilt</SelectItem>
                          <SelectItem value="single_axis">Single-axis tracker</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <NumberField
                      label="GCR (shading)"
                      source={sources.gcr}
                      overridden={isOverridden("gcr")}
                      {...form.register("gcr")}
                    />
                    <NumberField
                      label="Array DC (kWp)"
                      source={sources.array_dc_kwp}
                      overridden={isOverridden("arrayDcKwp")}
                      {...form.register("arrayDcKwp")}
                    />
                    <NumberField
                      label="Inverter AC (kW)"
                      source={sources.inverter_ac_kw}
                      overridden={isOverridden("inverterAcKw")}
                      {...form.register("inverterAcKw")}
                    />
                    <NumberField
                      label="DC wiring loss (%)"
                      source={sources.dc_wiring_loss_pct}
                      overridden={isOverridden("dcWiringLossPct")}
                      {...form.register("dcWiringLossPct")}
                    />
                    <NumberField
                      label="Module NOCT (°C)"
                      source="library.module"
                      overridden={isOverridden("moduleNoctC")}
                      {...form.register("moduleNoctC")}
                    />
                    <NumberField
                      label="Pmax coefficient (%/°C)"
                      source="library.module"
                      overridden={isOverridden("modulePmaxPctPerC")}
                      {...form.register("modulePmaxPctPerC")}
                    />
                    <NumberField
                      label="Mismatch (%)"
                      overridden={isOverridden("mismatchPct")}
                      {...form.register("mismatchPct")}
                    />
                    <NumberField
                      label="Transformer loss (%)"
                      overridden={isOverridden("transformerLossPct")}
                      {...form.register("transformerLossPct")}
                    />
                    <NumberField
                      label="MV collection loss (%)"
                      overridden={isOverridden("mvCollectionLossPct")}
                      {...form.register("mvCollectionLossPct")}
                    />
                    <NumberField
                      label="Grid availability (%)"
                      overridden={isOverridden("gridAvailabilityPct")}
                      {...form.register("gridAvailabilityPct")}
                    />
                    <NumberField
                      label="Plant availability (%)"
                      overridden={isOverridden("plantAvailabilityPct")}
                      {...form.register("plantAvailabilityPct")}
                    />
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <Label className="text-xs" htmlFor="gridLimitKw">
                          Export limit / curtailment (kW)
                        </Label>
                        <SourceTag
                          source={sources.grid_limit_kw}
                          overridden={isOverridden("gridLimitKw")}
                        />
                      </div>
                      <Input
                        id="gridLimitKw"
                        type="number"
                        step="any"
                        placeholder="Unlimited"
                        {...form.register("gridLimitKw")}
                      />
                    </div>
                    <NumberField
                      label="Degradation year 1 (%)"
                      source="library.module"
                      overridden={isOverridden("degradationYear1Pct")}
                      {...form.register("degradationYear1Pct")}
                    />
                    <NumberField
                      label="Auxiliary load (kW)"
                      overridden={isOverridden("auxiliaryLoadKw")}
                      {...form.register("auxiliaryLoadKw")}
                    />
                    <NumberField
                      label="BESS round-trip (%)"
                      source={sources.bess}
                      disabled={!values.bessEnabled}
                      overridden={isOverridden("bessRoundTripPct")}
                      {...form.register("bessRoundTripPct")}
                    />
                    <NumberField
                      label="BESS throughput fraction"
                      source={sources.bess}
                      disabled={!values.bessEnabled}
                      overridden={isOverridden("bessThroughputFraction")}
                      {...form.register("bessThroughputFraction")}
                    />
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <Label className="text-xs" htmlFor="sigmaPct">
                          Interannual variability σ (%)
                        </Label>
                        <SourceTag source="optional" />
                      </div>
                      <Input
                        id="sigmaPct"
                        type="number"
                        step="any"
                        placeholder="Empty → P-scenarios disabled"
                        {...form.register("sigmaPct")}
                      />
                    </div>
                  </div>

                  {!pf?.bess.configured ? (
                    <p className="text-xs text-muted-foreground">
                      BESS inputs are disabled — no battery entry is configured for this project.
                    </p>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <Button type="submit" disabled={!canWrite || run.isPending}>
                      <Play className="size-4" aria-hidden />
                      {run.isPending ? "Running…" : "Run simulation"}
                    </Button>
                    {!canWrite ? (
                      <span className="text-xs text-muted-foreground">
                        Read-only — engineering roles can run simulations.
                      </span>
                    ) : null}
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results" className="mt-4 space-y-4">
            {simulations.length === 0 ? (
              <EmptyState
                icon={Play}
                title="No simulations yet"
                description="Fill in the input sheet and run the transparent model to see the loss chain."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs">Simulation</Label>
                  <Select value={selected?.id ?? ""} onValueChange={(v) => setSelectedId(v)}>
                    <SelectTrigger className="w-80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {simulations.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.is_baseline ? " · baseline" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected ? <StatusBadge status={selected.status} /> : null}
                </div>
                {selected ? <PvSimulationResults simulation={selected} /> : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="approval" className="mt-4 space-y-4">
            {!selected ? (
              <EmptyState
                icon={Send}
                title="Nothing to review"
                description="Run a simulation first, then submit it for engineering approval."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {selected.name} <StatusBadge className="ml-2" status={selected.status} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Approval status</p>
                      <p className="font-medium">{instance?.status ?? "not submitted"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current step</p>
                      <p className="font-medium">
                        {instance ? `Step ${instance.current_step ?? 1} · engineering_admin` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">SLA age</p>
                      <p className="font-medium">
                        {instance
                          ? formatDistanceToNowStrict(new Date(instance.requested_at), {
                              addSuffix: true,
                            })
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      disabled={!canWrite || submit.isPending || Boolean(instance)}
                      onClick={() => submit.mutate(selected.id)}
                    >
                      <Send className="size-4" aria-hidden />
                      Submit for approval
                    </Button>
                    {isApproved ? (
                      <Button
                        disabled={!canWrite || baseline.isPending || selected.is_baseline}
                        onClick={() => baseline.mutate(selected.id)}
                      >
                        <BadgeCheck className="size-4" aria-hidden />
                        {selected.is_baseline ? "Current baseline" : "Set as project baseline"}
                      </Button>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">
                        Baselining unlocks once the approval instance is approved — the server
                        rejects earlier attempts.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="compare" className="mt-4 space-y-4">
            {simulations.length < 2 ? (
              <EmptyState
                icon={GitCompare}
                title="Need two simulations"
                description="Run at least two simulations to compare annual energy, yield, PR and each loss step."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Compare runs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <Select value={selected?.id ?? ""} onValueChange={setSelectedId}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Baseline run" />
                      </SelectTrigger>
                      <SelectContent>
                        {simulations.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={compareId ?? ""} onValueChange={setCompareId}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Compare with…" />
                      </SelectTrigger>
                      <SelectContent>
                        {simulations
                          .filter((s) => s.id !== selected?.id)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selected && compare ? (
                    <PvSimulationCompare a={selected} b={compare} />
                  ) : (
                    <EmptyState
                      compact
                      icon={GitCompare}
                      title="Pick a second simulation"
                      description="Select two runs to see the delta table."
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
