// GC-11 — Portfolio scenario & risk forecasting workspace.
// Non-posting overlays only: every base figure comes from the authoritative
// portfolio consolidation and no approved forecast is ever written here.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Copy, Download, LineChart, Lock, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ScenarioAssumptions } from "@/components/portfolio/scenario-assumptions";
import {
  ScenarioBridge,
  ScenarioComparisonTable,
  ScenarioProjectTable,
} from "@/components/portfolio/scenario-bridge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  createPortfolioScenario,
  deletePortfolioScenario,
  deletePortfolioScenarioAssumption,
  duplicatePortfolioScenario,
  getPortfolioScenarioCsv,
  savePortfolioScenarioAssumption,
  transitionPortfolioScenario,
} from "@/lib/portfolio-scenarios.functions";
import {
  portfolioScenarioQueryOptions,
  portfolioScenariosQueryOptions,
} from "@/lib/portfolio-scenarios.query";
import type { AssumptionSaveInput, ScenarioFxMode } from "@/lib/portfolio-scenarios.rules";

const K = "portfolioMod.costing.scenarios";
const NONE = "__none__";

const searchSchema = z.object({
  id: z.string().uuid().optional(),
  compare: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/scenarios")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio scenarios & risk forecasting | GridMind EPC" },
      {
        name: "description",
        content:
          "Model risk, escalation, contingency and FX stress on top of the approved consolidated portfolio position without touching approved forecasts.",
      },
      { property: "og:title", content: "Portfolio scenarios & risk forecasting | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Non-posting what-if overlays with an EAC bridge that ties to the published total.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => (
    <div className="page-shell">
      <Skeleton className="h-64 w-full" />
    </div>
  ),
  errorComponent: ScenariosError,
  notFoundComponent: ScenariosMissing,
  component: ScenariosPage,
});

function ScenariosError() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={AlertTriangle}
        title={t(`${K}.error.title`)}
        description={t(`${K}.error.description`)}
      />
    </div>
  );
}

function ScenariosMissing() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={LineChart}
        title={t(`${K}.empty.title`)}
        description={t(`${K}.empty.description`)}
      />
    </div>
  );
}

function ScenariosPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  return (
    <div className="page-shell space-y-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          <Button asChild variant="outline">
            <Link to="/portfolio/costing">
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span>{t(`${K}.back`)}</span>
            </Link>
          </Button>
        }
      />
      <ScenarioList />
      {search.id ? <ScenarioWorkspace key={search.id} /> : null}
    </div>
  );
}

function ScenarioList() {
  const { t, locale } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const { data: scenarios } = useSuspenseQuery(portfolioScenariosQueryOptions({}));

  const [name, setName] = useState("");
  const [fxMode, setFxMode] = useState<ScenarioFxMode>("snapshot");
  const [shock, setShock] = useState("0");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portfolio", "scenarios"] });

  const create = useMutation({
    mutationFn: (input: { name: string; fx_mode: ScenarioFxMode; fx_shock_pct: number }) =>
      createPortfolioScenario({
        data: {
          name: input.name,
          purpose: null,
          notes: null,
          source_basis: "period_end",
          fx_mode: input.fx_mode,
          fx_shock_pct: input.fx_shock_pct,
          horizon_months: 12,
        },
      }),
    onSuccess: async (created) => {
      toast.success(t(`${K}.created`));
      setName("");
      await refresh();
      void navigate({ search: (prev) => ({ ...prev, id: created.id }) });
    },
    onError: (e: Error) => toast.error(e.message || t(`${K}.actionFailed`)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePortfolioScenario({ data: { id } }),
    onSuccess: async (_r, id) => {
      toast.success(t(`${K}.deleted`));
      await refresh();
      if (search.id === id) void navigate({ search: () => ({}) });
    },
    onError: (e: Error) => toast.error(e.message || t(`${K}.actionFailed`)),
  });

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">{t(`${K}.listHeading`)}</h2>
      <p className="text-muted-foreground text-sm">{t(`${K}.listDescription`)}</p>

      <form
        className="mt-4 grid gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({ name: name.trim(), fx_mode: fxMode, fx_shock_pct: Number(shock) || 0 });
        }}
      >
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="scn-name">{t(`${K}.name`)}</Label>
          <Input id="scn-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="scn-fx">{t(`${K}.fxMode`)}</Label>
          <Select value={fxMode} onValueChange={(v) => setFxMode(v as ScenarioFxMode)}>
            <SelectTrigger id="scn-fx">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["snapshot", "current", "shock"] as const).map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`${K}.fxModes.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="scn-shock">{t(`${K}.fxShock`)}</Label>
          <Input
            id="scn-shock"
            inputMode="decimal"
            value={shock}
            onChange={(e) => setShock(e.target.value)}
            disabled={fxMode !== "shock"}
          />
        </div>
        <div className="md:col-span-4">
          <Button type="submit" disabled={create.isPending}>
            {t(`${K}.create`)}
          </Button>
        </div>
      </form>

      <div className="mt-6">
        {scenarios.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t(`${K}.none`)}</p>
        ) : (
          <Table>
            <caption className="sr-only">{t(`${K}.listDescription`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.name`)}</TableHead>
                <TableHead scope="col">{t(`${K}.status`)}</TableHead>
                <TableHead scope="col">{t(`${K}.period`)}</TableHead>
                <TableHead scope="col">{t(`${K}.currency`)}</TableHead>
                <TableHead scope="col">{t(`${K}.fxMode`)}</TableHead>
                <TableHead scope="col">{t(`${K}.updated`)}</TableHead>
                <TableHead scope="col" className="sr-only">
                  {t(`${K}.delete`)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((s) => (
                <TableRow key={s.id} aria-current={search.id === s.id ? "true" : undefined}>
                  <TableCell>
                    <Link
                      to="/portfolio/costing/scenarios"
                      search={{ id: s.id }}
                      className="font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                    {s.purpose ? (
                      <div className="text-muted-foreground text-xs">{s.purpose}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={s.status === "locked" ? "approved" : s.status}
                      label={t(`${K}.statuses.${s.status}`)}
                    />
                  </TableCell>
                  <TableCell>{s.source_period.slice(0, 7)}</TableCell>
                  <TableCell>{s.reporting_currency}</TableCell>
                  <TableCell>{t(`${K}.fxModes.${s.fx_mode}`)}</TableCell>
                  <TableCell>{formatDate(s.updated_at, locale)}</TableCell>
                  <TableCell className="text-end">
                    {s.is_owner && s.status === "draft" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(s.id)}
                      >
                        {t(`${K}.delete`)}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Card>
  );
}

function ScenarioWorkspace() {
  const { t, locale } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const id = search.id!;
  const { data } = useSuspenseQuery(portfolioScenarioQueryOptions(id, search.compare ?? null));
  const { data: scenarios } = useSuspenseQuery(portfolioScenariosQueryOptions({}));

  const currency = data.scenario.reporting_currency;
  const money = (v: number | null) => (v === null ? "—" : formatCurrency(v, locale, currency));
  const readOnly = data.scenario.status !== "draft" || !data.scenario.is_owner;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["portfolio", "scenario", id] });
    await queryClient.invalidateQueries({ queryKey: ["portfolio", "scenarios"] });
  };
  const fail = (e: Error) => toast.error(e.message || t(`${K}.actionFailed`));

  const saveAssumption = useMutation({
    mutationFn: (input: AssumptionSaveInput) => savePortfolioScenarioAssumption({ data: input }),
    onSuccess: async () => {
      toast.success(t(`${K}.assumptionSaved`));
      await refresh();
    },
    onError: fail,
  });

  const removeAssumption = useMutation({
    mutationFn: (assumptionId: string) =>
      deletePortfolioScenarioAssumption({ data: { id: assumptionId, scenario_id: id } }),
    onSuccess: async () => {
      toast.success(t(`${K}.assumptionRemoved`));
      await refresh();
    },
    onError: fail,
  });

  const transition = useMutation({
    mutationFn: (action: "share" | "unshare" | "lock" | "archive") =>
      transitionPortfolioScenario({ data: { id, action } }),
    onSuccess: async () => {
      toast.success(t(`${K}.saved`));
      await refresh();
    },
    onError: fail,
  });

  const duplicate = useMutation({
    mutationFn: () =>
      duplicatePortfolioScenario({ data: { id, name: `${data.scenario.name} (copy)` } }),
    onSuccess: async (created) => {
      toast.success(t(`${K}.duplicated`));
      await refresh();
      void navigate({ search: (prev) => ({ ...prev, id: created.id }) });
    },
    onError: fail,
  });

  const exportCsv = useMutation({
    mutationFn: () => getPortfolioScenarioCsv({ data: { id } }),
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: () => toast.error(t(`${K}.exportFailed`)),
  });

  const projects = data.results.map((r) => ({ id: r.project_id, code: r.code, name: r.name }));
  const comparable = scenarios.filter((s) => s.id !== id);

  return (
    <section className="space-y-6" aria-label={data.scenario.name}>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{data.scenario.name}</h2>
            <p className="text-muted-foreground text-sm">
              {t(`${K}.period`)}: {data.base.period.slice(0, 7)} · {t(`${K}.currency`)}: {currency}{" "}
              · {t(`${K}.fxModes.${data.scenario.fx_mode}`)}
            </p>
            {!data.base.official ? (
              <p className="text-muted-foreground text-xs">{t(`${K}.indicative`)}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportCsv.mutate()}>
              <Download className="size-4" aria-hidden="true" />
              <span>{t(`${K}.exportCsv`)}</span>
            </Button>
            <Button variant="outline" onClick={() => duplicate.mutate()}>
              <Copy className="size-4" aria-hidden="true" />
              <span>{t(`${K}.duplicate`)}</span>
            </Button>
            {data.scenario.is_owner && data.scenario.status === "draft" ? (
              <Button variant="outline" onClick={() => transition.mutate("share")}>
                <Share2 className="size-4" aria-hidden="true" />
                <span>{t(`${K}.share`)}</span>
              </Button>
            ) : null}
            {data.scenario.is_owner && data.scenario.status === "shared" ? (
              <Button variant="outline" onClick={() => transition.mutate("unshare")}>
                <Share2 className="size-4" aria-hidden="true" />
                <span>{t(`${K}.unshare`)}</span>
              </Button>
            ) : null}
            {data.scenario.is_owner &&
            data.scenario.status !== "locked" &&
            data.scenario.status !== "archived" ? (
              <Button variant="outline" onClick={() => transition.mutate("lock")}>
                <Lock className="size-4" aria-hidden="true" />
                <span>{t(`${K}.lock`)}</span>
              </Button>
            ) : null}
            {data.scenario.status !== "archived" ? (
              <Button variant="ghost" onClick={() => transition.mutate("archive")}>
                {t(`${K}.archive`)}
              </Button>
            ) : null}
          </div>
        </div>

        <KpiGrid className="mt-5">
          <KpiTile label={t(`${K}.baseEac`)} value={money(data.totals.base_eac)} />
          <KpiTile label={t(`${K}.scenarioEac`)} value={money(data.totals.scenario_eac)} />
          <KpiTile label={t(`${K}.deltaEac`)} value={money(data.totals.delta_eac)} />
          <KpiTile label={t(`${K}.p80`)} value={money(data.totals.p80)} />
          <KpiTile label={t(`${K}.vac`)} value={money(data.totals.scenario_vac)} />
          <KpiTile label={t(`${K}.included`)} value={String(data.totals.included)} />
        </KpiGrid>
        {data.totals.excluded.length ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {t(`${K}.excluded`)}: {data.totals.excluded.map((e) => e.code).join(", ")}
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold">{t(`${K}.assumptions`)}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{t(`${K}.assumptionsDescription`)}</p>
        <ScenarioAssumptions
          scenarioId={id}
          assumptions={data.assumptions}
          projects={projects}
          readOnly={readOnly}
          busy={saveAssumption.isPending || removeAssumption.isPending}
          onSave={(input) => saveAssumption.mutate(input)}
          onDelete={(assumptionId) => removeAssumption.mutate(assumptionId)}
        />
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold">{t(`${K}.bridge`)}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{t(`${K}.bridgeDescription`)}</p>
        <ScenarioBridge bridge={data.bridge} currency={currency} />
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold">{t(`${K}.comparison`)}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{t(`${K}.comparisonDescription`)}</p>
        <div className="mb-4 max-w-xs space-y-1">
          <Label htmlFor="scn-compare">{t(`${K}.compare`)}</Label>
          <Select
            value={search.compare ?? NONE}
            onValueChange={(v) =>
              navigate({
                search: (prev) => ({ ...prev, compare: v === NONE ? undefined : v }),
              })
            }
          >
            <SelectTrigger id="scn-compare">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t(`${K}.compareNone`)}</SelectItem>
              {comparable.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data.comparison ? (
          <ScenarioComparisonTable
            lines={data.comparison.lines}
            currency={currency}
            leftName={data.scenario.name}
            rightName={data.comparison.scenario.name}
          />
        ) : (
          <ScenarioProjectTable results={data.results} currency={currency} />
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold">{t(`${K}.history`)}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{t(`${K}.historyDescription`)}</p>
        <ul className="space-y-2 text-sm">
          {data.history.map((h, i) => (
            <li key={`${h.created_at}-${i}`} className="flex flex-wrap gap-2">
              <span className="font-medium">{h.action}</span>
              <span className="text-muted-foreground">{formatDate(h.created_at, locale)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
