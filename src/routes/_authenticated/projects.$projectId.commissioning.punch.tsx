// P-096 — Commissioning punch closure board.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  closePunchItem,
  listCommissioningPunch,
  type CommissioningPunchBoard,
  type CommissioningPunchRow,
} from "@/lib/commissioning-punch.functions";
import {
  PUNCH_CATEGORY_SEMANTICS,
  SIGNOFF_PARTIES,
  SIGNOFF_PARTY_LABELS,
  requiredParties,
  type SignoffParty,
} from "@/lib/commissioning-punch.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/commissioning/punch")({
  head: () => ({
    meta: [
      { title: "Punch closure — GridMind EPC" },
      {
        name: "description",
        content: "Category A/B/C punch closure workflow with multi-party signoffs before COD.",
      },
      { property: "og:title", content: "Punch closure — GridMind EPC" },
      {
        property: "og:description",
        content: "Category A/B/C punch closure workflow with multi-party signoffs before COD.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PunchClosureBoard,
});

type Category = "A" | "B" | "C";
const CATEGORIES: Category[] = ["A", "B", "C"];

function categoryTint(cat: Category): string {
  switch (cat) {
    case "A":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "B":
      return "bg-warning/15 text-warning border-warning/30";
    case "C":
      return "bg-muted text-muted-foreground border-border";
  }
}

function PunchClosureBoard() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const [dialogItem, setDialogItem] = useState<CommissioningPunchRow | null>(null);

  const query = useQuery({
    queryKey: ["commissioning-punch", projectId] as const,
    queryFn: () => listCommissioningPunch({ data: { projectId } }),
  });

  const board: CommissioningPunchBoard | undefined = query.data;
  const items = board?.items ?? [];
  const canClose = board?.permissions.canClose ?? false;

  const stats = useMemo(() => {
    const s: Record<Category, { open: number; closed: number; total: number }> = {
      A: { open: 0, closed: 0, total: 0 },
      B: { open: 0, closed: 0, total: 0 },
      C: { open: 0, closed: 0, total: 0 },
    };
    for (const it of items) {
      const bucket = s[it.category];
      bucket.total += 1;
      if (it.status === "closed") bucket.closed += 1;
      else bucket.open += 1;
    }
    const total = items.length;
    const closed = items.filter((i) => i.status === "closed").length;
    const closurePct = total === 0 ? 0 : Math.round((closed / total) * 100);
    return { per: s, total, closed, closurePct, aOpen: s.A.open };
  }, [items]);

  const lanes = useMemo(() => {
    const m: Record<Category, CommissioningPunchRow[]> = { A: [], B: [], C: [] };
    for (const it of items) m[it.category].push(it);
    return m;
  }, [items]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Punch closure
          </h2>
          <p className="text-sm text-muted-foreground">
            Multi-party signoffs by category — category A must close before COD.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
              <ShieldCheck size={14} aria-hidden />
              Back to tests
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} aria-hidden className={cn(query.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {stats.aOpen > 0 ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle size={16} aria-hidden />
          <span className="font-medium">
            COD blocked — {stats.aOpen} category A item
            {stats.aOpen === 1 ? "" : "s"} open
          </span>
        </div>
      ) : null}

      {/* KPI header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Closure %</p>
          <p className="mt-1 font-display text-2xl font-semibold text-foreground">
            {stats.closurePct}%
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.closed} of {stats.total} closed
          </p>
        </Card>
        {CATEGORIES.map((c) => (
          <Card key={c} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Category {c}</p>
              <Badge variant="outline" className={cn("text-xs", categoryTint(c))}>
                {stats.per[c].open} open
              </Badge>
            </div>
            <p className="mt-1 font-display text-2xl font-semibold text-foreground">
              {stats.per[c].closed}/{stats.per[c].total}
            </p>
            <p className="text-xs text-muted-foreground">closed</p>
          </Card>
        ))}
      </div>

      {/* Legend */}
      <Card className="p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Category semantics
        </p>
        <div className="grid gap-2 text-sm md:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c} className="flex items-start gap-2">
              <Badge variant="outline" className={cn("shrink-0", categoryTint(c))}>
                {PUNCH_CATEGORY_SEMANTICS[c].label}
              </Badge>
              <span className="text-muted-foreground">{PUNCH_CATEGORY_SEMANTICS[c].requires}</span>
            </div>
          ))}
        </div>
      </Card>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {CATEGORIES.map((c) => (
            <Skeleton key={c} className="h-64 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-destructive">Failed to load punch items.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center">
          <ShieldCheck size={28} aria-hidden className="mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            No open punch items — ready for COD review
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {CATEGORIES.map((c) => (
            <PunchLane
              key={c}
              category={c}
              items={lanes[c]}
              canClose={canClose}
              onClose={(it) => setDialogItem(it)}
            />
          ))}
        </div>
      )}

      <ClosePunchDialog
        item={dialogItem}
        projectId={projectId}
        companyId={board?.companyId ?? null}
        open={!!dialogItem}
        onOpenChange={(open) => {
          if (!open) setDialogItem(null);
        }}
        onDone={() => {
          setDialogItem(null);
          qc.invalidateQueries({ queryKey: ["commissioning-punch", projectId] });
        }}
      />
    </div>
  );
}

function PunchLane({
  category,
  items,
  canClose,
  onClose,
}: {
  category: Category;
  items: CommissioningPunchRow[];
  canClose: boolean;
  onClose: (item: CommissioningPunchRow) => void;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={categoryTint(category)}>
          {PUNCH_CATEGORY_SEMANTICS[category].label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No items in this lane.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <PunchLaneCard key={it.id} item={it} canClose={canClose} onClose={onClose} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PunchLaneCard({
  item,
  canClose,
  onClose,
}: {
  item: CommissioningPunchRow;
  canClose: boolean;
  onClose: (item: CommissioningPunchRow) => void;
}) {
  const partiesHave = new Set(item.signoffs.map((s) => s.signoff_party));
  const required = requiredParties(item.category, item.utility_witness_required);
  const missing = required.filter((p) => !partiesHave.has(p));
  const isClosed = item.status === "closed";

  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {item.punch_number} — {item.area}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-xs",
            isClosed
              ? "bg-success/15 text-success border-success/30"
              : "bg-muted text-foreground",
          )}
        >
          {isClosed ? "Closed" : "Open"}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {SIGNOFF_PARTIES.map((p) => {
          const has = partiesHave.has(p);
          const req = required.includes(p);
          if (!req && !has) return null;
          return (
            <Badge
              key={p}
              variant="outline"
              className={cn(
                "text-[10px]",
                has
                  ? "bg-success/15 text-success border-success/30"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {has ? "✓" : "·"} {SIGNOFF_PARTY_LABELS[p]}
            </Badge>
          );
        })}
      </div>
      {!isClosed && canClose ? (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Missing:{" "}
            {missing.length === 0 ? "—" : missing.map((p) => SIGNOFF_PARTY_LABELS[p]).join(", ")}
          </p>
          <Button size="sm" variant="outline" onClick={() => onClose(item)}>
            Close
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ClosePunchDialog({
  item,
  projectId,
  companyId,
  open,
  onOpenChange,
  onDone,
}: {
  item: CommissioningPunchRow | null;
  projectId: string;
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [party, setParty] = useState<SignoffParty>("contractor");
  const [signerName, setSignerName] = useState("");
  const [evidencePath, setEvidencePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      closePunchItem({
        data: {
          punchItemId: item!.id,
          party,
          signerName: signerName.trim(),
          evidencePath: evidencePath ?? undefined,
        },
      }),
    onSuccess: (res) => {
      if (res.closed) toast.success(`Punch ${res.item.punch_number} closed`);
      else
        toast.success(
          `Signoff recorded — awaiting ${res.missing_parties
            .map((p) => SIGNOFF_PARTY_LABELS[p])
            .join(", ")}`,
        );
      setSignerName("");
      setEvidencePath(null);
      setParty("contractor");
      onDone();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to close punch item");
    },
  });

  const uploadEvidence = async (file: File) => {
    if (!item || !companyId) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const path = `${companyId}/punch-evidence/${projectId}/${item.id}/${id}.${ext}`;
      const { error } = await supabase.storage.from("closeout").upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (error) throw error;
      setEvidencePath(path);
      toast.success("Evidence attached");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const available = SIGNOFF_PARTIES.filter(
    (p) => p !== "utility" || (item?.utility_witness_required ?? false),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record signoff</DialogTitle>
          <DialogDescription>
            {item ? (
              <>
                {item.punch_number} — {item.area} (Category {item.category})
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="party">Party</Label>
            <Select value={party} onValueChange={(v) => setParty(v as SignoffParty)}>
              <SelectTrigger id="party">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p} value={p}>
                    {SIGNOFF_PARTY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="signer-name">Signer name</Label>
            <Input
              id="signer-name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div>
            <Label htmlFor="evidence">Evidence (optional)</Label>
            <Input
              id="evidence"
              type="file"
              disabled={uploading || !companyId}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadEvidence(f);
              }}
            />
            {evidencePath ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Attached: {evidencePath.split("/").pop()}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || uploading || signerName.trim().length < 2}
          >
            {mutation.isPending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : null}
            Record signoff
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
