// P-202 — Bonds & guarantees register with instrument detail drawer.
import { useMemo, useState, type ChangeEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, Plus, Search, ShieldCheck, Siren, Timer } from "lucide-react";
import { toast } from "sonner";

import { CoverageByTypeChart, InsuranceSummaryCards } from "@/components/bonds/bond-coverage";
import { BondRenewalSection } from "@/components/bonds/bond-renewal";
import { BondWorkflowSections } from "@/components/bonds/bond-workflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  activateBondInstrument,
  createBondInstrument,
  exportBondsCsv,
  uploadBondDocument,
} from "@/lib/bonds.functions";
import {
  bondDetailQueryOptions,
  bondErrorMessage,
  bondsRegisterQueryOptions,
} from "@/lib/bonds.query";
import {
  BENEFICIARY_TYPES,
  BOND_STATUSES,
  CreateBondSchema,
  FORMULAS,
  INSTRUMENT_TYPES,
  INSTRUMENT_TYPE_META,
  ISSUER_TYPES,
  countdownLabel,
  countdownTone,
  instrumentTypeLabel,
  titleize,
  type BondRow,
  type CountdownTone,
  type CreateBondInput,
  type ListBondsInput,
} from "@/lib/bonds.rules";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/finance/bonds")({
  head: () => ({
    meta: [
      { title: "Bonds & guarantees — GridMind EPC" },
      {
        name: "description",
        content:
          "Register of bank guarantees, bonds and insurance instruments with expiry countdowns, coverage per currency and outstanding claims.",
      },
      { property: "og:title", content: "Bonds & guarantees — GridMind EPC" },
      {
        property: "og:description",
        content: "Track bond coverage, expiries and claims across every EPC project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { expiring?: number } => {
    const raw = Number(search.expiring);
    return Number.isFinite(raw) && raw > 0 ? { expiring: raw } : {};
  },
  component: BondsPage,
});

function fmt(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const CHIP_TONE: Record<CountdownTone, string> = {
  good: "bg-accent/10 text-accent",
  warning: "bg-warning/15 text-warning",
  bad: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

function Formula({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">formula</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

function CountdownChip({ days }: { days: number | null }) {
  const tone = countdownTone(days);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_TONE[tone]}`}>
      {countdownLabel(days)}
    </span>
  );
}

function BondsPage() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [project, setProject] = useState("all");
  const [issuer, setIssuer] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const filters: ListBondsInput = useMemo(
    () => ({
      instrument_type: type === "all" ? undefined : (type as ListBondsInput["instrument_type"]),
      status: status === "all" ? undefined : (status as ListBondsInput["status"]),
      project_id: project === "all" ? undefined : project,
      issuer: issuer.trim() || undefined,
    }),
    [type, status, project, issuer],
  );

  const { expiring } = Route.useSearch();
  const registerQ = useQuery(bondsRegisterQueryOptions(filters));
  const exportFn = useServerFn(exportBondsCsv);
  const data = registerQ.data;
  const allRows = data?.rows ?? [];
  const rows =
    expiring === undefined
      ? allRows
      : allRows.filter(
          (r) => r.days_to_expiry !== null && r.days_to_expiry >= 0 && r.days_to_expiry <= expiring,
        );
  const kpis = data?.kpis;

  async function handleExport() {
    try {
      const res = await exportFn({ data: filters });
      downloadCsv(res.filename, res.csv);
    } catch (err) {
      toast.error(bondErrorMessage(err));
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Bonds & guarantees"
        description="Bank guarantees, bonds and insurance instruments — coverage, expiries and claims."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={handleExport}>
              <Download className="mr-2 size-4" /> Export CSV
            </Button>
            {data?.can_write ? (
              <Button size="sm" onClick={() => setWizardOpen(true)}>
                <Plus className="mr-2 size-4" /> New instrument
              </Button>
            ) : null}
          </div>
        }
      />

      <KpiGrid>
        <KpiTile
          label="Active coverage"
          icon={ShieldCheck}
          isLoading={registerQ.isPending}
          value={
            kpis && kpis.coverage.length > 0
              ? fmt(kpis.coverage[0].amount, kpis.coverage[0].currency_code)
              : "—"
          }
          hint={
            <span>
              {kpis && kpis.coverage.length > 1
                ? `${kpis.coverage
                    .slice(1)
                    .map((c) => fmt(c.amount, c.currency_code))
                    .join(" · ")} · `
                : ""}
              <Formula text={FORMULAS.coverage} />
            </span>
          }
        />
        <KpiTile
          label="Expiring ≤ 30 days"
          icon={Siren}
          status={kpis && kpis.expiring_30 > 0 ? "bad" : "neutral"}
          isLoading={registerQ.isPending}
          value={kpis?.expiring_30 ?? 0}
          hint={<Formula text={FORMULAS.expiring30} />}
        />
        <KpiTile
          label="Expiring ≤ 90 days"
          icon={Timer}
          status={kpis && kpis.expiring_90 > 0 ? "warning" : "neutral"}
          isLoading={registerQ.isPending}
          value={kpis?.expiring_90 ?? 0}
          hint={<Formula text={FORMULAS.expiring90} />}
        />
        <KpiTile
          label="Claims outstanding"
          icon={AlertTriangle}
          status={kpis && kpis.claims_outstanding > 0 ? "bad" : "neutral"}
          isLoading={registerQ.isPending}
          value={kpis?.claims_outstanding ?? 0}
          hint={<Formula text={FORMULAS.claims} />}
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Instrument type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {INSTRUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {INSTRUMENT_TYPE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {BOND_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleize(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(data?.projects ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
        </div>
      </div>

      {registerQ.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : registerQ.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load the register"
          description={bondErrorMessage(registerQ.error)}
          action={<Button onClick={() => registerQ.refetch()}>Retry</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No instruments yet"
          description="Register your first bond, guarantee or insurance policy to start tracking coverage and expiries."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Beneficiary</TableHead>
                <TableHead>Issuer</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: BondRow) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(r.id);
                  }}
                >
                  <TableCell className="font-medium">{r.instrument_number}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{instrumentTypeLabel(r.instrument_type)}</Badge>
                  </TableCell>
                  <TableCell>{r.beneficiary_name}</TableCell>
                  <TableCell>{r.issuer_name}</TableCell>
                  <TableCell>{r.principal_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(r.amount, r.currency_code)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{r.expiry_date ?? "—"}</span>
                      <CountdownChip days={r.days_to_expiry} />
                    </div>
                  </TableCell>
                  <TableCell>{r.project_name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.effective_status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewInstrumentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        currencies={data?.currencies ?? []}
        projects={data?.projects ?? []}
        contracts={data?.contracts ?? []}
        filters={filters}
      />

      <InstrumentDrawer instrumentId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
interface WizardProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currencies: string[];
  projects: { id: string; name: string }[];
  contracts: { id: string; label: string; project_id: string | null }[];
  filters: ListBondsInput;
}

const EMPTY_FORM = {
  instrument_type: "performance_bond",
  beneficiary_name: "",
  beneficiary_type: "client",
  issuer_name: "",
  issuer_type: "bank",
  principal_name: "",
  amount: "",
  currency_code: "",
  premium_pct: "",
  issue_date: "",
  effective_date: "",
  expiry_date: "",
  auto_renew: false,
  project_id: "",
  contract_id: "",
  notes: "",
};

function NewInstrumentWizard({
  open,
  onOpenChange,
  currencies,
  projects,
  contracts,
  filters,
}: WizardProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createFn = useServerFn(createBondInstrument);
  const qc = useQueryClient();

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function buildPayload(): CreateBondInput | null {
    const candidate = {
      instrument_type: form.instrument_type,
      beneficiary_name: form.beneficiary_name,
      beneficiary_type: form.beneficiary_type,
      issuer_name: form.issuer_name,
      issuer_type: form.issuer_type,
      principal_name: form.principal_name || undefined,
      amount: Number(form.amount),
      currency_code: form.currency_code,
      premium_pct: form.premium_pct ? Number(form.premium_pct) : undefined,
      issue_date: form.issue_date,
      effective_date: form.effective_date || undefined,
      expiry_date: form.expiry_date || undefined,
      auto_renew: form.auto_renew,
      project_id: form.project_id || undefined,
      contract_id: form.contract_id || undefined,
      notes: form.notes || undefined,
    };
    const parsed = CreateBondSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return null;
    }
    setError(null);
    return parsed.data;
  }

  async function submit() {
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      const res = await createFn({ data: payload });
      toast.success(`${res.instrument.instrument_number} created as draft.`);
      await qc.invalidateQueries({ queryKey: ["bonds"] });
      onOpenChange(false);
      setForm({ ...EMPTY_FORM });
      setStep(1);
    } catch (err) {
      setError(bondErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New instrument — step {step} of 4</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Pick the instrument type."
              : step === 2
                ? "Who is protected, who issues it, and who it is for."
                : step === 3
                  ? "Commercial terms and validity dates."
                  : "Link the instrument to a project and contract."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-2">
            {INSTRUMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("instrument_type", t)}
                className={`rounded-md border p-3 text-left text-sm transition-colors ${
                  form.instrument_type === t ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">{INSTRUMENT_TYPE_META[t].label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {INSTRUMENT_TYPE_META[t].description}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ben">Beneficiary name</Label>
              <Input
                id="ben"
                value={form.beneficiary_name}
                onChange={(e) => set("beneficiary_name", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Beneficiary type</Label>
              <Select
                value={form.beneficiary_type}
                onValueChange={(v) => set("beneficiary_type", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BENEFICIARY_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {titleize(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iss">Issuer name</Label>
              <Input
                id="iss"
                value={form.issuer_name}
                onChange={(e) => set("issuer_name", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Issuer type</Label>
              <Select value={form.issuer_type} onValueChange={(v) => set("issuer_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUER_TYPES.map((i) => (
                    <SelectItem key={i} value={i}>
                      {titleize(i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pri">Principal</Label>
              <Input
                id="pri"
                placeholder="Who the bond is for — us or a counterparty"
                value={form.principal_name}
                onChange={(e) => set("principal_name", e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="amt">Amount</Label>
              <Input
                id="amt"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Select value={form.currency_code} onValueChange={(v) => set("currency_code", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prem">Premium %</Label>
              <Input
                id="prem"
                type="number"
                min="0"
                step="0.01"
                value={form.premium_pct}
                onChange={(e) => set("premium_pct", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                id="auto"
                checked={form.auto_renew}
                onCheckedChange={(v) => set("auto_renew", v)}
              />
              <Label htmlFor="auto">Auto-renew</Label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d1">Issue date</Label>
              <Input
                id="d1"
                type="date"
                value={form.issue_date}
                onChange={(e) => set("issue_date", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d2">Effective date</Label>
              <Input
                id="d2"
                type="date"
                value={form.effective_date}
                onChange={(e) => set("effective_date", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d3">Expiry date</Label>
              <Input
                id="d3"
                type="date"
                value={form.expiry_date}
                onChange={(e) => set("expiry_date", e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select value={form.project_id} onValueChange={(v) => set("project_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Contract</Label>
              <Select value={form.contract_id} onValueChange={(v) => set("contract_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="No contract" />
                </SelectTrigger>
                <SelectContent>
                  {contracts
                    .filter((c) => !form.project_id || c.project_id === form.project_id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Back
          </Button>
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : (
            <Button disabled={saving} onClick={submit}>
              {saving ? "Creating…" : "Create instrument"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function InstrumentDrawer({
  instrumentId,
  onClose,
}: {
  instrumentId: string | null;
  onClose: () => void;
}) {
  const detailQ = useQuery(bondDetailQueryOptions(instrumentId));
  const activateFn = useServerFn(activateBondInstrument);
  const uploadFn = useServerFn(uploadBondDocument);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const d = detailQ.data;

  async function handleActivate() {
    if (!instrumentId) return;
    setBusy(true);
    try {
      await activateFn({ data: { instrument_id: instrumentId } });
      toast.success("Instrument activated.");
      await qc.invalidateQueries({ queryKey: ["bonds"] });
    } catch (err) {
      toast.error(bondErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !instrumentId) return;
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      buf.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      await uploadFn({
        data: {
          instrument_id: instrumentId,
          filename: file.name,
          content_base64: btoa(binary),
          content_type: file.type || undefined,
        },
      });
      toast.success("Document uploaded.");
      await qc.invalidateQueries({ queryKey: ["bonds"] });
    } catch (err) {
      toast.error(bondErrorMessage(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <Sheet open={Boolean(instrumentId)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{d?.instrument.instrument_number ?? "Instrument"}</SheetTitle>
          <SheetDescription>
            {d ? instrumentTypeLabel(d.instrument.instrument_type) : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {detailQ.isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : detailQ.isError || !d ? (
          <div className="p-4">
            <EmptyState
              icon={AlertTriangle}
              title="Could not load this instrument"
              description={bondErrorMessage(detailQ.error)}
            />
          </div>
        ) : (
          <div className="space-y-6 p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="tabular-nums">
                  {fmt(d.instrument.amount, d.instrument.currency_code)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={d.instrument.effective_status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Beneficiary</dt>
                <dd>
                  {d.instrument.beneficiary_name} ({titleize(d.instrument.beneficiary_type)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Issuer</dt>
                <dd>
                  {d.instrument.issuer_name} ({titleize(d.instrument.issuer_type)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Expiry</dt>
                <dd className="flex items-center gap-2">
                  {d.instrument.expiry_date ?? "—"}
                  <CountdownChip days={d.instrument.days_to_expiry} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Auto-renew</dt>
                <dd>{d.instrument.auto_renew ? "Yes" : "No"}</dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Document</h3>
              {d.document_url ? (
                <a
                  className="text-sm text-primary underline"
                  href={d.document_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download signed copy
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">No document uploaded yet.</p>
              )}
              {d.can_write ? <Input type="file" disabled={busy} onChange={handleUpload} /> : null}
            </section>

            {d.can_write && d.instrument.status === "draft" ? (
              <section className="space-y-2">
                <Button disabled={busy} onClick={handleActivate}>
                  Activate instrument
                </Button>
                {d.activation_blockers.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {d.activation_blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Lifecycle</h3>
              {d.timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded yet.</p>
              ) : (
                <ol className="space-y-2 border-l pl-4 text-sm">
                  {d.timeline.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <span className="font-medium">{e.label}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {e.at.slice(0, 10)}
                        {e.detail ? ` · ${e.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <BondWorkflowSections detail={d} />

            <BondRenewalSection detail={d} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
