// P-074 — Risk register table view.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import {
  ageOfRow,
  RISK_CATEGORIES,
  RISK_CATEGORY_LABEL,
  RISK_STATUS_LABEL,
  RISK_STATUSES,
  type RiskCategory,
  type RiskStatus,
} from "@/lib/risks.rules";
import type { RiskRow } from "@/lib/risks.functions";
import { buildRisksCsv, downloadCsv } from "@/lib/risks.csv";

interface Props {
  risks: RiskRow[];
  canWrite: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
}

export function RiskRegisterTable({ risks, canWrite, onNew, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<RiskCategory | "all">("all");
  const [status, setStatus] = useState<RiskStatus | "all">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return risks.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (status !== "all" && r.status !== status) return false;
      if (needle) {
        const hay = `${r.title} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [risks, q, cat, status]);

  const today = new Date();

  const handleExport = () => {
    downloadCsv(`risks-${format(today, "yyyyMMdd-HHmm")}.csv`, buildRisksCsv(filtered));
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-2 border-border bg-card p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={14}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or description"
            className="pl-7"
            aria-label="Search risks"
          />
        </div>
        <Select value={cat} onValueChange={(v) => setCat(v as any)}>
          <SelectTrigger className="w-[160px]" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {RISK_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {RISK_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[140px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RISK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {RISK_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download size={14} aria-hidden className="mr-1" />
          Export CSV
        </Button>
        {canWrite && (
          <Button size="sm" onClick={onNew}>
            <Plus size={14} aria-hidden className="mr-1" />
            New risk
          </Button>
        )}
      </Card>

      {filtered.length === 0 ? (
        <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {risks.length === 0
            ? "No risks logged — a stale register fails lender due diligence."
            : "No risks match the current filters."}
        </Card>
      ) : (
        <Card className="border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">P</TableHead>
                <TableHead className="text-center">I</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target close</TableHead>
                <TableHead className="text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r.id)}>
                  <TableCell className="font-medium text-foreground">{r.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{RISK_CATEGORY_LABEL[r.category]}</Badge>
                  </TableCell>
                  <TableCell className="text-center">{r.probability}</TableCell>
                  <TableCell className="text-center">{r.impact}</TableCell>
                  <TableCell
                    className={cn(
                      "text-center font-semibold",
                      r.score >= 15 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {r.score}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.owner_name || r.owner_email || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.target_close_date
                      ? format(new Date(r.target_close_date), "MMM d, yyyy")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {ageOfRow(r, today)}d
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RiskStatus }) {
  const tone: Record<RiskStatus, string> = {
    open: "bg-primary/15 text-primary border-primary/30",
    mitigating: "bg-warning/15 text-warning border-warning/30",
    realized: "bg-destructive/15 text-destructive border-destructive/30",
    closed: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
        tone[status],
      )}
    >
      {RISK_STATUS_LABEL[status]}
    </span>
  );
}
