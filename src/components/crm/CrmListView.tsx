import { useServerFn } from "@tanstack/react-start";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { downloadCsv } from "@/lib/csv";
import {
  exportOpportunitiesCsv,
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  type OpportunityRow,
  type OpportunityStage,
} from "@/lib/crm.functions";

const ARCHETYPE_OPTS = [
  "utility_pv",
  "standalone_bess",
  "c_and_i_rooftop",
  "onshore_wind",
  "hybrid_pv_bess",
  "transmission_substation",
  "green_hydrogen",
] as const;

interface Props {
  opportunities: OpportunityRow[];
}

export function CrmListView({ opportunities }: Props) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<OpportunityStage | "">("");
  const [archetype, setArchetype] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const exportFn = useServerFn(exportOpportunitiesCsv);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of opportunities) {
      if (o.owner_id && !map.has(o.owner_id)) {
        map.set(o.owner_id, o.owner?.full_name || o.owner?.email || "Unknown");
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [opportunities]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (stage && o.stage !== stage) return false;
      if (archetype && o.archetype !== archetype) return false;
      if (ownerId && o.owner_id !== ownerId) return false;
      if (needle) {
        const hay = `${o.name} ${o.account_name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [opportunities, q, stage, archetype, ownerId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportFn({
        data: {
          search: q || undefined,
          stage: (stage || undefined) as any,
          archetype: (archetype || undefined) as any,
          ownerId: ownerId || undefined,
        },
      });
      downloadCsv(res.filename, res.csv);
      toast.success("CSV downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 border-border bg-card p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={16}
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or account"
            className="pl-8"
          />
        </div>
        <FilterSelect
          label="Stage"
          value={stage}
          onChange={(v) => setStage(v as OpportunityStage | "")}
          options={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
        />
        <FilterSelect
          label="Archetype"
          value={archetype}
          onChange={setArchetype}
          options={ARCHETYPE_OPTS.map((a) => ({ value: a, label: a.replace(/_/g, " ") }))}
        />
        <FilterSelect
          label="Owner"
          value={ownerId}
          onChange={setOwnerId}
          options={owners.map((o) => ({ value: o.id, label: o.label }))}
        />
        <Button variant="outline" onClick={handleExport} disabled={exporting || rows.length === 0}>
          <Download size={16} aria-hidden />
          Export CSV
        </Button>
      </Card>

      <Card className="border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Prob.</TableHead>
              <TableHead>Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No opportunities match your filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.account_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {STAGE_LABELS[o.stage]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {o.estimated_value != null
                      ? new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: o.currency_code || "USD",
                          maximumFractionDigits: 0,
                        }).format(o.estimated_value)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {o.probability ?? 0}%
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.owner?.full_name || o.owner?.email || "Unassigned"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
