// P-108 — Warranties workspace.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Inbox, Search, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { WarrantyDialog } from "@/components/warranties/warranty-dialog";
import { WarrantyDrawer } from "@/components/warranties/warranty-drawer";
import {
  getWarrantyKpis,
  listWarranties,
  listWarrantyProjects,
  type WarrantyRow,
} from "@/lib/warranties.functions";
import {
  daysRemaining,
  warrantyStatusBadge,
  WARRANTY_TYPES,
  type WarrantyType,
} from "@/lib/warranties.rules";

export const Route = createFileRoute("/_authenticated/om/warranties")({
  head: () => ({
    meta: [
      { title: "Warranties · GridMind EPC" },
      {
        name: "description",
        content:
          "Register manufacturer, EPC, extended, and performance warranties; track claims and coverage.",
      },
    ],
  }),
  component: WarrantiesPage,
  errorComponent: ({ error, reset }) => (
    <div className="page-shell">
      <EmptyState
        icon={ShieldAlert}
        title="Failed to load warranties"
        description={error.message}
        action={
          <Button size="sm" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  ),
});

function CoverageBadge({ dateISO }: { dateISO: string }) {
  const days = daysRemaining(dateISO);
  const badge = warrantyStatusBadge(days);
  if (badge === "expired") {
    return <Badge className="bg-muted text-muted-foreground">Expired {Math.abs(days)}d</Badge>;
  }
  if (badge === "expiring") {
    return <Badge className="bg-warning text-warning-foreground">In {days}d</Badge>;
  }
  return <Badge className="bg-success text-success-foreground">Active · {days}d</Badge>;
}

function toCsv(rows: WarrantyRow[]): string {
  const header = [
    "Equipment",
    "Vendor",
    "Project",
    "Type",
    "Start",
    "End",
    "Days remaining",
    "Claims",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.equipment_tag ?? "",
      r.vendor_name ?? "",
      r.project_name ?? "",
      r.warranty_type,
      r.start_date,
      r.end_date,
      String(daysRemaining(r.end_date)),
      String(r.claim_count ?? 0),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function WarrantiesPage() {
  const listFn = useServerFn(listWarranties);
  const kpisFn = useServerFn(getWarrantyKpis);
  const projectsFn = useServerFn(listWarrantyProjects);

  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string>("all");
  const [warrantyType, setWarrantyType] = useState<string>("all");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [drawer, setDrawer] = useState<WarrantyRow | null>(null);

  const projects = useQuery({
    queryKey: ["warranty-projects"],
    queryFn: () => projectsFn(),
  });

  const filters = useMemo(
    () => ({
      project_id: projectId === "all" ? undefined : projectId,
      warranty_type: warrantyType === "all" ? undefined : (warrantyType as WarrantyType),
      expiring_within_days: expiringOnly ? 90 : undefined,
      q: q || undefined,
    }),
    [projectId, warrantyType, expiringOnly, q],
  );

  const listQ = useQuery({
    queryKey: ["warranties", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const kpisQ = useQuery({
    queryKey: ["warranty-kpis", filters.project_id],
    queryFn: () => kpisFn({ data: { project_id: filters.project_id } }),
  });

  const rows = (listQ.data ?? []) as WarrantyRow[];

  const exportCsv = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warranties-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Warranties"
        description="Manufacturer, EPC, extended, and performance warranties across your O&amp;M fleet."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <WarrantyDialog />
          </div>
        }
      />

      <KpiGrid>
        <KpiTile
          label="Active coverage"
          value={kpisQ.data?.activeCoveragePct == null ? "—" : `${kpisQ.data.activeCoveragePct}%`}
          hint={
            kpisQ.data
              ? `${kpisQ.data.coveredEquipment}/${kpisQ.data.activeEquipment} active equipment covered`
              : undefined
          }
          isLoading={kpisQ.isLoading}
        />
        <KpiTile
          label="Contracts"
          value={kpisQ.data?.contracts ?? "—"}
          isLoading={kpisQ.isLoading}
        />
        <KpiTile
          label="Expiring <90d"
          value={kpisQ.data?.expiringSoon ?? "—"}
          isLoading={kpisQ.isLoading}
        />
        <KpiTile
          label="Open claims"
          value={kpisQ.data?.openClaims ?? "—"}
          isLoading={kpisQ.isLoading}
        />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Registry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-64 pl-8"
                placeholder="Search equipment, vendor, project…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={warrantyType} onValueChange={setWarrantyType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {WARRANTY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={expiringOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setExpiringOnly((v) => !v)}
            >
              Expiring &lt;90d
            </Button>
          </div>

          {listQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No warranties"
              description="Register your first warranty to start tracking coverage."
              action={<WarrantyDialog />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start – End</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Claims</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDrawer(r)}>
                    <TableCell>
                      <div className="font-medium">
                        {r.equipment_tag ?? (
                          <span className="text-muted-foreground">Project-wide</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.project_name}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.vendor_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.warranty_type.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.start_date} → {r.end_date}
                    </TableCell>
                    <TableCell>
                      <CoverageBadge dateISO={r.end_date} />
                    </TableCell>
                    <TableCell className="text-sm">{r.claim_count ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <WarrantyDrawer
        warranty={drawer}
        open={!!drawer}
        onOpenChange={(o) => !o && setDrawer(null)}
      />
    </div>
  );
}
