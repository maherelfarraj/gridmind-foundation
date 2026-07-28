// P-157 — PV yield simulation workspace: input sheet → run → results → approval.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, BadgeCheck, GitCompare, Info, Play, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
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
import { FormErrorSummary } from "@/components/ui/form-error-summary";
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
import { useI18n } from "@/lib/i18n/locale-provider";

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

// Human messages: a blank or out-of-range entry must read as an instruction the
// operator can act on, never as a bare zod default they never see.
const num = (label: string, min: number, max: number, unit = "") =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .min(min, `${label} must be ${min}–${max}${unit}`)
    .max(max, `${label} must be ${min}–${max}${unit}`);

const formSchema = z.object({
  name: z.string().min(1, "Name the run").max(120, "Run name must be 120 characters or fewer"),
  tiltDeg: num("Tilt", 0, 90, "°"),
  azimuthDeg: num("Azimuth", -180, 180, "°"),
  albedo: num("Albedo", 0, 1),
  tracker: z.enum(["fixed", "single_axis"]),
  gcr: num("GCR", 0.05, 0.95),
  arrayDcKwp: z.coerce
    .number({ message: "Array DC must be a number" })
    .positive("Array DC must be greater than zero"),
  inverterAcKw: z.coerce
    .number({ message: "Inverter AC must be a number" })
    .positive("Inverter AC must be greater than zero"),
  moduleNoctC: num("Module NOCT", 20, 70, "°C"),
  modulePmaxPctPerC: num("Pmax temperature coefficient", -1, 0, "%/°C"),
  mismatchPct: num("Mismatch loss", 0, 20, "%"),
  dcWiringLossPct: num("DC wiring loss", 0, 20, "%"),
  transformerLossPct: num("Transformer loss", 0, 10, "%"),
  mvCollectionLossPct: num("MV collection loss", 0, 10, "%"),
  gridAvailabilityPct: num("Grid availability", 0, 100, "%"),
  plantAvailabilityPct: num("Plant availability", 0, 100, "%"),
  gridLimitKw: z
    .string()
    .refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      "Grid limit must be a number, or leave it blank for no limit",
    ),
  degradationYear1Pct: num("Year-1 degradation", 0, 20, "%"),
  auxiliaryLoadKw: z.coerce
    .number({ message: "Auxiliary load must be a number" })
    .min(0, "Auxiliary load must be 0 or more"),
  bessEnabled: z.boolean(),
  bessRoundTripPct: num("BESS round-trip efficiency", 50, 100, "%"),
  bessThroughputFraction: num("BESS throughput fraction", 0, 1),
  sigmaPct: z
    .string()
    .refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      "Sigma must be a number, or leave it blank for the model default",
    ),
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
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-1.5">
      {source ? (
        <span className="font-mono text-[10px] text-muted-foreground">{source}</span>
      ) : null}
      {overridden ? (
        <Badge variant="outline" className="h-4 px-1 text-[10px]">
          {t("pv.simulation.form.overridden")}
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
  // Every numeric input owns an error slot: a resolver rejection on this field
  // must be visible next to the input, not swallowed into a dead submit button.
  const ctx = useFormContext();
  const raw = rest.name ? ctx?.formState.errors?.[rest.name] : undefined;
  const error = typeof raw?.message === "string" ? raw.message : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs" htmlFor={rest.name}>
          {label}
        </Label>
        <SourceTag source={source} overridden={overridden} />
      </div>
      <Input
        id={rest.name}
        type="number"
        step="any"
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function PvSimulationPage() {
  const { t } = useI18n();
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
        title={t("engMod.pv.simulation.title")}
        description={t("engMod.pv.simulation.description")}
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
          title={t("engMod.pv.simulation.loadError.title")}
          description={t("engMod.pv.simulation.loadError.description")}
        />
      ) : (
        <Tabs defaultValue="inputs">
          <TabsList>
            <TabsTrigger value="inputs">{t("engMod.pv.simulation.tabs.inputSheet")}</TabsTrigger>
            <TabsTrigger value="results">{t("engMod.pv.simulation.tabs.results")}</TabsTrigger>
            <TabsTrigger value="approval">{t("engMod.pv.simulation.tabs.approval")}</TabsTrigger>
            <TabsTrigger value="compare">{t("engMod.pv.simulation.tabs.compare")}</TabsTrigger>
          </TabsList>

          <TabsContent value="inputs" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="size-4" aria-hidden /> {t("engMod.pv.simulation.serverPrefilled")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">{t("engMod.pv.simulation.siteConfiguration")}</p>
                    <p className="font-medium">{pf?.siteConfig.name ?? t("engMod.pv.simulation.noActiveSiteConfig")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("engMod.pv.simulation.approvedLayout")}</p>
                    <p className="font-medium">
                      {pf?.layout.name ?? t("engMod.pv.simulation.noneApproved")}{" "}
                      {pf?.layout.layoutNumber ? `(${pf.layout.layoutNumber})` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("engMod.pv.simulation.stringing")}</p>
                    <p className="font-medium">
                      {pf?.stringing.stringCount ?? 0} {t("engMod.pv.simulation.strings")} · {pf?.stringing.dcAcRatio ?? "—"}{" "}
                      DC/AC
                    </p>
                  </div>
                </div>

                <FormProvider {...form}>
                  <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs">
                        {t("engMod.pv.simulation.runName")}
                      </Label>
                      <Input
                        id="name"
                        aria-invalid={form.formState.errors.name ? true : undefined}
                        {...form.register("name")}
                      />
                      {form.formState.errors.name ? (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.name.message}
                        </p>
                      ) : null}
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
                          <Label className="text-xs">{t("engMod.pv.simulation.mounting")}</Label>
                          <SourceTag
                            source={sources.tracker}
                            overridden={isOverridden("tracker")}
                          />
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
                            <SelectItem value="fixed">{t("engMod.pv.simulation.fixedTilt")}</SelectItem>
                            <SelectItem value="single_axis">{t("engMod.pv.simulation.singleAxisTracker")}</SelectItem>
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
                            {t("pv.simulation.form.gridLimitLabel")}
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
                        {t("engMod.pv.simulation.form.bessDisabledNote")}
                      </p>
                    ) : null}

                    <FormErrorSummary errors={form.formState.errors} />

                    <div className="flex items-center gap-3">
                      <Button type="submit" disabled={!canWrite || run.isPending}>
                        <Play className="size-4" aria-hidden />
                        {run.isPending ? t("engMod.pv.simulation.form.running") : t("engMod.pv.simulation.form.runButton")}
                      </Button>
                      {!canWrite ? (
                        <span className="text-xs text-muted-foreground">
                          {t("engMod.pv.simulation.form.readOnlyNote")}
                        </span>
                      ) : null}
                    </div>
                  </form>
                </FormProvider>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results" className="mt-4 space-y-4">
            {simulations.length === 0 ? (
              <EmptyState
                icon={Play}
                title={t("engMod.pv.simulation.resultsEmpty.title")}
                description={t("engMod.pv.simulation.resultsEmpty.description")}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs">{t("engMod.pv.simulation.simulationLabel")}</Label>
                  <Select value={selected?.id ?? ""} onValueChange={(v) => setSelectedId(v)}>
                    <SelectTrigger className="w-80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {simulations.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.is_baseline ? t("engMod.pv.simulation.baselineSuffix") : ""}
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
                title={t("engMod.pv.simulation.approval.nothingToReview.title")}
                description={t("engMod.pv.simulation.approval.nothingToReview.description")}
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
                      <p className="text-xs text-muted-foreground">{t("engMod.pv.simulation.approval.approvalStatus")}</p>
                      <p className="font-medium">{instance?.status ?? t("engMod.pv.simulation.approval.notSubmitted")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("engMod.pv.simulation.approval.currentStep")}</p>
                      <p className="font-medium">
                        {instance ? t("engMod.pv.simulation.approval.stepEngineeringAdmin", { step: instance.current_step ?? 1 }) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("engMod.pv.simulation.approval.slaAge")}</p>
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
                      {t("engMod.pv.simulation.approval.submitForApproval")}
                    </Button>
                    {isApproved ? (
                      <Button
                        disabled={!canWrite || baseline.isPending || selected.is_baseline}
                        onClick={() => baseline.mutate(selected.id)}
                      >
                        <BadgeCheck className="size-4" aria-hidden />
                        {selected.is_baseline ? t("engMod.pv.simulation.approval.currentBaseline") : t("engMod.pv.simulation.approval.setAsBaseline")}
                      </Button>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">
                        {t("engMod.pv.simulation.approval.baselineLocked")}
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
                title={t("engMod.pv.simulation.compare.needTwo.title")}
                description={t("engMod.pv.simulation.compare.needTwo.description")}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("engMod.pv.simulation.compare.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <Select value={selected?.id ?? ""} onValueChange={setSelectedId}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder={t("engMod.pv.simulation.compare.baselinePlaceholder")} />
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
                        <SelectValue placeholder={t("engMod.pv.simulation.compare.comparePlaceholder")} />
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
                      title={t("engMod.pv.simulation.compare.pickSecond.title")}
                      description={t("engMod.pv.simulation.compare.pickSecond.description")}
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
