// GC-11 — Scenario assumption editor. Presentation + form state only:
// all validation and money maths live server-side in the scenario rules.
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  SCENARIO_DRIVERS,
  type AssumptionSaveInput,
  type ScenarioAssumption,
  type ScenarioDriver,
} from "@/lib/portfolio-scenarios.rules";

const K = "portfolioMod.costing.scenarios";
const ALL_PROJECTS = "__all__";

export interface ScenarioProjectOption {
  id: string;
  code: string;
  name: string;
}

export function ScenarioAssumptions({
  scenarioId,
  assumptions,
  projects,
  readOnly,
  onSave,
  onDelete,
  busy,
}: {
  scenarioId: string;
  assumptions: ScenarioAssumption[];
  projects: ScenarioProjectOption[];
  readOnly: boolean;
  onSave: (input: AssumptionSaveInput) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [driver, setDriver] = useState<ScenarioDriver>("etc_adjust");
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pct, setPct] = useState("");
  const [probability, setProbability] = useState("");
  const [delay, setDelay] = useState("");

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      scenario_id: scenarioId,
      project_id: projectId === ALL_PROJECTS ? null : projectId,
      cost_code_id: null,
      driver,
      period_month: null,
      label: label.trim() === "" ? null : label.trim(),
      amount: num(amount),
      pct: num(pct),
      probability: num(probability),
      delay_months: delay.trim() === "" ? null : Number(delay),
      currency_code: null,
      source_table: null,
      source_id: null,
      note: null,
      sort_order: assumptions.length,
    });
    setLabel("");
    setAmount("");
    setPct("");
    setProbability("");
    setDelay("");
  };

  return (
    <div className="space-y-4">
      <Table>
        <caption className="sr-only">{t(`${K}.assumptionsDescription`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.driver`)}</TableHead>
            <TableHead scope="col">{t(`${K}.project`)}</TableHead>
            <TableHead scope="col">{t(`${K}.label`)}</TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.amount`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.pct`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.probability`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.delayMonths`)}
            </TableHead>
            <TableHead scope="col" className="sr-only">
              {t(`${K}.remove`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assumptions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-muted-foreground text-sm">
                {t(`${K}.assumptionsDescription`)}
              </TableCell>
            </TableRow>
          ) : (
            assumptions.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{t(`${K}.drivers.${a.driver}`)}</TableCell>
                <TableCell>
                  {a.project_id
                    ? (projects.find((p) => p.id === a.project_id)?.code ??
                      a.project_id.slice(0, 8))
                    : t(`${K}.allProjects`)}
                </TableCell>
                <TableCell>{a.label ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">{a.amount ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">{a.pct ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">{a.probability ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">{a.delay_months ?? "—"}</TableCell>
                <TableCell className="text-end">
                  {readOnly ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={`${t(`${K}.remove`)} ${a.label ?? t(`${K}.drivers.${a.driver}`)}`}
                      disabled={busy}
                      onClick={() => onDelete(a.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {readOnly ? (
        <p className="text-muted-foreground text-sm">{t(`${K}.readOnly`)}</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-7">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="scn-driver">{t(`${K}.driver`)}</Label>
            <Select value={driver} onValueChange={(v) => setDriver(v as ScenarioDriver)}>
              <SelectTrigger id="scn-driver">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIO_DRIVERS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {t(`${K}.drivers.${d}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="scn-project">{t(`${K}.project`)}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="scn-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS}>{t(`${K}.allProjects`)}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="scn-label">{t(`${K}.label`)}</Label>
            <Input id="scn-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scn-amount">{t(`${K}.amount`)}</Label>
            <Input
              id="scn-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scn-pct">{t(`${K}.pct`)}</Label>
            <Input
              id="scn-pct"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scn-prob">{t(`${K}.probability`)}</Label>
            <Input
              id="scn-prob"
              inputMode="decimal"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scn-delay">{t(`${K}.delayMonths`)}</Label>
            <Input
              id="scn-delay"
              inputMode="numeric"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
            />
          </div>
          <div className="flex items-end md:col-span-3">
            <Button type="submit" disabled={busy}>
              {t(`${K}.addAssumption`)}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
