// P-213 — Revision history drawer: supersedes chain + client-side pair diff.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { GitBranch, History } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { createEstimateRevision } from "@/lib/estimating.functions";
import { estimateRevisionsQueryOptions, estimatingErrorMessage } from "@/lib/estimating.query";
import { canCreateRevision, diffRevisions } from "@/lib/estimating/revision-diff";
import { formatDate, formatMoney } from "@/lib/format";

export function RevisionHistoryDrawer({
  estimateId,
  status,
  canWrite,
}: {
  estimateId: string;
  status: string;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({ ...estimateRevisionsQueryOptions(estimateId), enabled: open });
  const revise = useServerFn(createEstimateRevision);

  const newRevision = useMutation({
    mutationFn: () => revise({ data: { estimate_id: estimateId } }),
    onSuccess: (res) => {
      toast.success(`Revision R${res.revision} created as a fresh draft.`);
      void queryClient.invalidateQueries({ queryKey: ["estimating"] });
      setOpen(false);
      void navigate({ to: "/estimating/$id", params: { id: res.id } });
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const revisions = query.data?.revisions ?? [];
  const lines = query.data?.lines ?? {};

  const diff = useMemo(() => {
    if (!selected) return null;
    const index = revisions.findIndex((r) => r.id === selected);
    const next = revisions[index];
    const prev = revisions[index + 1];
    if (!next || !prev) return null;
    return diffRevisions(
      { summary: prev, lines: lines[prev.id] ?? [] },
      { summary: next, lines: lines[next.id] ?? [] },
    );
  }, [selected, revisions, lines]);

  const selectedRevision = revisions.find((r) => r.id === selected) ?? null;
  const currency = selectedRevision?.currency_code ?? revisions[0]?.currency_code ?? "USD";

  return (
    <div className="flex items-center gap-2">
      {canWrite && canCreateRevision(status) ? (
        <Button
          variant="outline"
          size="sm"
          disabled={newRevision.isPending}
          onClick={() => newRevision.mutate()}
        >
          <GitBranch className="mr-2 size-4" /> New revision
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <History className="mr-2 size-4" /> Revision history
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Revision history</SheetTitle>
            <SheetDescription>
              Select a revision to diff it against the one it superseded.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-4">
            {query.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : revisions.length <= 1 ? (
              <EmptyState
                icon={History}
                title="No prior revisions"
                description="This estimate has not been revised yet."
              />
            ) : (
              <ul className="space-y-2">
                {revisions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.id === selected ? null : r.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        r.id === selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm">{r.estimate_number ?? "Draft"}</span>
                          <Badge variant="mutedOutline">R{r.revision}</Badge>
                          <StatusBadge status={r.status} />
                        </span>
                        <span className="tabular-nums text-sm font-semibold">
                          {formatMoney(r.total_price, r.currency_code, {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {r.priced_at ? `Priced ${formatDate(r.priced_at)} · ` : ""}
                        {r.submitted_at ? `Submitted ${formatDate(r.submitted_at)} · ` : ""}
                        {r.actor ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && !diff ? (
              <p className="text-sm text-muted-foreground">
                This is the first revision — nothing to compare against.
              </p>
            ) : null}

            {diff ? (
              <div className="space-y-4 rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold">Diff vs prior revision</h3>

                <DiffBlock title="Margins" empty="No margin changes">
                  {diff.margins.map((m) => (
                    <Row
                      key={m.key}
                      label={m.label}
                      value={`${m.from.toFixed(1)}% → ${m.to.toFixed(1)}%`}
                    />
                  ))}
                </DiffBlock>

                <DiffBlock title="Totals" empty="No total changes">
                  {diff.totals.map((t) => (
                    <Row
                      key={t.key}
                      label={t.label}
                      value={`${formatMoney(t.from, currency, { maximumFractionDigits: 0 })} → ${formatMoney(
                        t.to,
                        currency,
                        { maximumFractionDigits: 0 },
                      )} (${t.delta > 0 ? "+" : ""}${formatMoney(t.delta, currency, {
                        maximumFractionDigits: 0,
                      })})`}
                    />
                  ))}
                </DiffBlock>

                <DiffBlock title={`Added (${diff.added.length})`} empty="No lines added">
                  {diff.added.map((l) => (
                    <Row
                      key={l.id}
                      label={l.description}
                      value={formatMoney(l.amount, currency, { maximumFractionDigits: 0 })}
                    />
                  ))}
                </DiffBlock>

                <DiffBlock title={`Removed (${diff.removed.length})`} empty="No lines removed">
                  {diff.removed.map((l) => (
                    <Row
                      key={l.id}
                      label={l.description}
                      value={formatMoney(l.amount, currency, { maximumFractionDigits: 0 })}
                    />
                  ))}
                </DiffBlock>

                <DiffBlock title={`Changed (${diff.changed.length})`} empty="No lines changed">
                  {diff.changed.map((c) => (
                    <Row
                      key={c.key}
                      label={c.description}
                      value={[
                        c.qty ? `qty ${c.qty.from} → ${c.qty.to}` : null,
                        c.unit_rate
                          ? `unit_rate ${c.unit_rate.from.toFixed(2)} → ${c.unit_rate.to.toFixed(2)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                </DiffBlock>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DiffBlock({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.flat() : [children];
  const hasItems = items.some(Boolean) && items.length > 0;
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      {hasItems ? (
        <div className="space-y-1">{children}</div>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
  );
}
