// GC-13 — Funding facility & allocation management: governed, role-gated, version-checked.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/components/cashflow/cash-format";
import {
  deleteFundingAllocationFn,
  saveFundingAllocationFn,
  saveFundingFacilityFn,
  type FacilityRow,
} from "@/lib/cashflow.functions";
import { fundingWorkspaceQueryOptions } from "@/lib/cashflow.query";
import { costingErrorMessage } from "@/lib/costing.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.funding";
const STATUSES = ["planned", "active", "expired", "cancelled"] as const;

export const Route = createFileRoute("/_authenticated/portfolio/costing/funding")({
  loader: ({ context }) => context.queryClient.ensureQueryData(fundingWorkspaceQueryOptions()),
  head: () => ({
    meta: [
      { title: "Funding facilities & allocations — GridMind" },
      {
        name: "description",
        content:
          "Manage company funding facilities, covenants and project allocations with role gating, version checks and a full audit trail.",
      },
      { property: "og:title", content: "Funding facilities & allocations — GridMind" },
      {
        property: "og:description",
        content: "Governed funding lines and project allocations across the portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FundingManagement,
});

interface FacilityDraft {
  id?: string;
  row_version?: number;
  name: string;
  lender_name: string;
  facility_kind: string;
  committed_amount: string;
  currency_code: string;
  available_from: string;
  expiry_date: string;
  status: (typeof STATUSES)[number];
  notes: string;
}

function toDraft(f: FacilityRow): FacilityDraft {
  return {
    id: f.id,
    ...(typeof f.row_version === "number" ? { row_version: f.row_version } : {}),
    name: f.name,
    lender_name: f.lender_name ?? "",
    facility_kind: f.facility_kind ?? "",
    committed_amount: String(f.committed_amount ?? 0),
    currency_code: f.currency_code,
    available_from: f.available_from ?? "",
    expiry_date: f.expiry_date ?? "",
    status: (f.status ?? "planned") as (typeof STATUSES)[number],
    notes: f.notes ?? "",
  };
}

const EMPTY_DRAFT: FacilityDraft = {
  name: "",
  lender_name: "",
  facility_kind: "",
  committed_amount: "0",
  currency_code: "USD",
  available_from: "",
  expiry_date: "",
  status: "planned",
  notes: "",
};

function FundingManagement() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(fundingWorkspaceQueryOptions());

  const saveFacility = useServerFn(saveFundingFacilityFn);
  const saveAllocation = useServerFn(saveFundingAllocationFn);
  const removeAllocation = useServerFn(deleteFundingAllocationFn);

  const [draft, setDraft] = useState<FacilityDraft | null>(null);
  const [allocDraft, setAllocDraft] = useState<{
    facility_id: string;
    project_id: string;
    allocated_amount: string;
    effective_from: string;
    effective_to: string;
    notes: string;
  } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cashflow"] });
  const onError = (e: unknown) => toast.error(costingErrorMessage(e));

  const facilityMutation = useMutation({
    mutationFn: (d: FacilityDraft) =>
      saveFacility({
        data: {
          ...(d.id ? { id: d.id, row_version: d.row_version ?? 1 } : {}),
          name: d.name.trim(),
          lender_name: d.lender_name.trim() || null,
          facility_kind: d.facility_kind.trim() || null,
          committed_amount: Number(d.committed_amount || 0),
          currency_code: d.currency_code.trim().toUpperCase(),
          available_from: d.available_from || null,
          expiry_date: d.expiry_date || null,
          status: d.status,
          notes: d.notes.trim() || null,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.facilities.saved`));
      setDraft(null);
      await invalidate();
    },
    onError,
  });

  const allocationMutation = useMutation({
    mutationFn: (d: NonNullable<typeof allocDraft>) => {
      const facility = data.facilities.find((f) => f.id === d.facility_id);
      return saveAllocation({
        data: {
          facility_id: d.facility_id,
          project_id: d.project_id,
          allocated_amount: Number(d.allocated_amount || 0),
          currency_code: facility?.currency_code ?? "USD",
          effective_from: d.effective_from || null,
          effective_to: d.effective_to || null,
          notes: d.notes.trim() || null,
        },
      });
    },
    onSuccess: async () => {
      toast.success(t(`${K}.allocations.saved`));
      setAllocDraft(null);
      await invalidate();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeAllocation({ data: { id } }),
    onSuccess: async () => {
      toast.success(t(`${K}.allocations.removed`));
      await invalidate();
    },
    onError,
  });

  const canWrite = data.access.canWrite;
  const busy =
    facilityMutation.isPending || allocationMutation.isPending || deleteMutation.isPending;

  const allocatedFor = (facilityId: string) =>
    data.allocations
      .filter((a) => a.facility_id === facilityId)
      .reduce((sum, a) => sum + Number(a.allocated_amount || 0), 0);

  const facilityName = (id: string) => data.facilities.find((f) => f.id === id)?.name ?? "—";
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.description`)}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={busy}>
              <Plus className="size-4" aria-hidden /> {t(`${K}.facilities.new`)}
            </Button>
          ) : null
        }
      />

      {!canWrite ? <p className="text-xs text-muted-foreground">{t(`${K}.readOnly`)}</p> : null}

      <Card className="flex flex-col gap-4 overflow-x-auto p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.facilities.title`)}</h2>
        {data.facilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.facilities.empty`)}</p>
        ) : (
          <Table>
            <caption className="sr-only">{t(`${K}.facilities.caption`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.facilities.name`)}</TableHead>
                <TableHead scope="col">{t(`${K}.facilities.lender`)}</TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.facilities.committed`)}
                </TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.facilities.allocated`)}
                </TableHead>
                <TableHead scope="col">{t(`${K}.facilities.expiry`)}</TableHead>
                <TableHead scope="col">{t(`${K}.facilities.status`)}</TableHead>
                <TableHead scope="col">{t(`${K}.facilities.actions`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.facilities.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="text-muted-foreground">{f.lender_name ?? "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(Number(f.committed_amount ?? 0), f.currency_code)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(allocatedFor(f.id), f.currency_code)}
                  </TableCell>
                  <TableCell className="tabular-nums">{f.expiry_date ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={f.status ?? "planned"} />
                  </TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setDraft(toDraft(f))}
                      >
                        {t(`${K}.facilities.edit`)}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {draft ? (
          <FacilityForm
            draft={draft}
            busy={busy}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSubmit={() => facilityMutation.mutate(draft)}
          />
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 overflow-x-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.allocations.title`)}</h2>
          {canWrite && data.facilities.length > 0 && data.projects.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                setAllocDraft({
                  facility_id: data.facilities[0]!.id,
                  project_id: data.projects[0]!.id,
                  allocated_amount: "0",
                  effective_from: "",
                  effective_to: "",
                  notes: "",
                })
              }
            >
              <Plus className="size-4" aria-hidden /> {t(`${K}.allocations.new`)}
            </Button>
          ) : null}
        </div>

        {data.allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.allocations.empty`)}</p>
        ) : (
          <Table>
            <caption className="sr-only">{t(`${K}.allocations.caption`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.allocations.facility`)}</TableHead>
                <TableHead scope="col">{t(`${K}.allocations.project`)}</TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.allocations.amount`)}
                </TableHead>
                <TableHead scope="col">{t(`${K}.allocations.from`)}</TableHead>
                <TableHead scope="col">{t(`${K}.allocations.to`)}</TableHead>
                <TableHead scope="col">{t(`${K}.allocations.actions`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{facilityName(a.facility_id)}</TableCell>
                  <TableCell>{projectName(a.project_id)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(Number(a.allocated_amount ?? 0), a.currency_code)}
                  </TableCell>
                  <TableCell className="tabular-nums">{a.effective_from ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{a.effective_to ?? "—"}</TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={t(`${K}.allocations.remove`)}
                        onClick={() => {
                          if (window.confirm(t(`${K}.allocations.confirmRemove`))) {
                            deleteMutation.mutate(a.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {allocDraft ? (
          <form
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(allocDraft.allocated_amount) < 0) {
                toast.error(t(`${K}.form.invalidAmount`));
                return;
              }
              allocationMutation.mutate(allocDraft);
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-facility">{t(`${K}.form.facility`)}</Label>
              <select
                id="alloc-facility"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={allocDraft.facility_id}
                onChange={(e) => setAllocDraft({ ...allocDraft, facility_id: e.target.value })}
              >
                {data.facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-project">{t(`${K}.form.project`)}</Label>
              <select
                id="alloc-project"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={allocDraft.project_id}
                onChange={(e) => setAllocDraft({ ...allocDraft, project_id: e.target.value })}
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-amount">{t(`${K}.form.amount`)}</Label>
              <Input
                id="alloc-amount"
                type="number"
                min="0"
                step="0.01"
                value={allocDraft.allocated_amount}
                onChange={(e) =>
                  setAllocDraft({ ...allocDraft, allocated_amount: e.target.value })
                }
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-from">{t(`${K}.allocations.from`)}</Label>
              <Input
                id="alloc-from"
                type="date"
                value={allocDraft.effective_from}
                onChange={(e) => setAllocDraft({ ...allocDraft, effective_from: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-to">{t(`${K}.allocations.to`)}</Label>
              <Input
                id="alloc-to"
                type="date"
                value={allocDraft.effective_to}
                onChange={(e) => setAllocDraft({ ...allocDraft, effective_to: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alloc-notes">{t(`${K}.form.reason`)}</Label>
              <Input
                id="alloc-notes"
                value={allocDraft.notes}
                onChange={(e) => setAllocDraft({ ...allocDraft, notes: e.target.value })}
                maxLength={2000}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>
                {t(`${K}.form.save`)}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAllocDraft(null)}>
                {t(`${K}.form.cancel`)}
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 overflow-x-auto p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.audit.title`)}</h2>
        {data.audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.audit.empty`)}</p>
        ) : (
          <Table>
            <caption className="sr-only">{t(`${K}.audit.caption`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.audit.when`)}</TableHead>
                <TableHead scope="col">{t(`${K}.audit.action`)}</TableHead>
                <TableHead scope="col">{t(`${K}.audit.entity`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.audit.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">{row.created_at.slice(0, 19)}</TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.entity === "funding_facilities"
                      ? facilityName(row.entity_id ?? "")
                      : row.entity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function FacilityForm({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: FacilityDraft;
  busy: boolean;
  onChange: (d: FacilityDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  return (
    <form
      className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number(draft.committed_amount) < 0) {
          toast.error(t(`${K}.form.invalidAmount`));
          return;
        }
        if (
          draft.available_from &&
          draft.expiry_date &&
          draft.expiry_date <= draft.available_from
        ) {
          toast.error(t(`${K}.form.invalidRange`));
          return;
        }
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-name">{t(`${K}.form.name`)}</Label>
        <Input
          id="fac-name"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          required
          minLength={2}
          maxLength={160}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-lender">{t(`${K}.form.lender`)}</Label>
        <Input
          id="fac-lender"
          value={draft.lender_name}
          onChange={(e) => onChange({ ...draft, lender_name: e.target.value })}
          maxLength={160}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-kind">{t(`${K}.form.kind`)}</Label>
        <Input
          id="fac-kind"
          value={draft.facility_kind}
          onChange={(e) => onChange({ ...draft, facility_kind: e.target.value })}
          maxLength={60}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-amount">{t(`${K}.form.committed`)}</Label>
        <Input
          id="fac-amount"
          type="number"
          min="0"
          step="0.01"
          value={draft.committed_amount}
          onChange={(e) => onChange({ ...draft, committed_amount: e.target.value })}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-currency">{t(`${K}.form.currency`)}</Label>
        <Input
          id="fac-currency"
          value={draft.currency_code}
          onChange={(e) => onChange({ ...draft, currency_code: e.target.value })}
          required
          maxLength={3}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-status">{t(`${K}.form.status`)}</Label>
        <select
          id="fac-status"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={draft.status}
          onChange={(e) =>
            onChange({ ...draft, status: e.target.value as (typeof STATUSES)[number] })
          }
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`${K}.status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-from">{t(`${K}.form.from`)}</Label>
        <Input
          id="fac-from"
          type="date"
          value={draft.available_from}
          onChange={(e) => onChange({ ...draft, available_from: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-expiry">{t(`${K}.form.expiry`)}</Label>
        <Input
          id="fac-expiry"
          type="date"
          value={draft.expiry_date}
          onChange={(e) => onChange({ ...draft, expiry_date: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="fac-notes">{t(`${K}.form.reason`)}</Label>
        <Input
          id="fac-notes"
          value={draft.notes}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          maxLength={2000}
        />
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={busy}>
          {t(`${K}.form.save`)}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t(`${K}.form.cancel`)}
        </Button>
      </div>
    </form>
  );
}
