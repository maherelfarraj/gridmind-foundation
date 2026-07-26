// P-150 — Company-level PV equipment library (browse, search, upload, certs).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PanelsTopLeft, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PvEquipmentDetailDrawer } from "@/components/engineering/pv-equipment-drawer";
import { PvEquipmentFormDrawer } from "@/components/engineering/pv-equipment-form";
import { tableColumns } from "@/components/engineering/pv-field-specs";
import { getPvLibraryWriteAccess, listPvEquipment } from "@/lib/pv-library.functions";
import { pvEquipmentListQueryOptions, pvWriteAccessQueryOptions } from "@/lib/pv-library-query";
import {
  PV_CATEGORIES,
  PV_CATEGORY_LABELS,
  isCertificationExpired,
  type PvCategory,
  type PvEquipmentRow,
} from "@/lib/pv-library.schemas";

export const Route = createFileRoute("/_authenticated/engineering/pv-library")({
  head: () => ({
    meta: [
      { title: "PV equipment library — GridMind EPC" },
      {
        name: "description",
        content:
          "Company-wide catalogue of PV modules, inverters and balance-of-system equipment with specs, certifications and warranties.",
      },
      { property: "og:title", content: "PV equipment library — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Browse tier-1 module and inverter specifications, upload spec sheets, and track certifications.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PvLibraryPage,
  errorComponent: PvLibraryError,
});

function PvLibraryError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load the equipment library</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}

function hasExpiredCert(row: PvEquipmentRow): boolean {
  return row.certifications.some((c) => isCertificationExpired(c.valid_until));
}

function PvLibraryPage() {
  const [category, setCategory] = useState<PvCategory>("module");
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<PvEquipmentRow | null>(null);

  const listFn = useServerFn(listPvEquipment);
  const accessFn = useServerFn(getPvLibraryWriteAccess);

  const filters = useMemo(
    () => ({ category, search: search.trim() || null, activeOnly }),
    [category, search, activeOnly],
  );

  const listQuery = useQuery(pvEquipmentListQueryOptions(listFn, filters));
  const accessQuery = useSuspenseQuery(pvWriteAccessQueryOptions(accessFn));
  const canWrite = accessQuery.data.canWrite;
  const rows = listQuery.data ?? [];
  const columns = tableColumns(category);

  const openEdit = (row: PvEquipmentRow | null) => {
    setEditRow(row);
    setFormOpen(true);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="PV equipment library"
        description="Company catalogue of modules, inverters and balance-of-system equipment used by design, stringing and BOM."
        actions={
          canWrite ? (
            <Button onClick={() => openEdit(null)}>
              <Plus className="mr-2 h-4 w-4" /> Add equipment
            </Button>
          ) : undefined
        }
      />

      <Tabs value={category} onValueChange={(v) => setCategory(v as PvCategory)}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {PV_CATEGORIES.map((c) => (
            <TabsTrigger key={c} value={c}>
              {PV_CATEGORY_LABELS[c]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search manufacturer or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="active-only" checked={activeOnly} onCheckedChange={setActiveOnly} />
          <Label htmlFor="active-only" className="text-sm">
            Active only
          </Label>
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : listQuery.error ? (
        <p className="text-sm text-destructive">{(listQuery.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PanelsTopLeft}
          title={`No ${PV_CATEGORY_LABELS[category].toLowerCase()} yet`}
          description="Add manufacturer specifications so stringing, yield and BOM calculations can use exact datasheet values."
          action={
            canWrite ? (
              <Button onClick={() => openEdit(null)}>
                <Plus className="mr-2 h-4 w-4" /> Add equipment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Manufacturer / model</TableHead>
              {columns.map((c) => (
                <TableHead key={c.label}>{c.label}</TableHead>
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                <TableCell>
                  <div className="font-medium text-foreground">{r.manufacturer}</div>
                  <div className="text-xs text-muted-foreground">{r.model}</div>
                </TableCell>
                {columns.map((c) => (
                  <TableCell key={c.label} className="tabular-nums">
                    {c.value(r)}
                  </TableCell>
                ))}
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={r.is_active ? "default" : "outline"}>
                      {r.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {hasExpiredCert(r) ? <Badge variant="destructive">Cert expired</Badge> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PvEquipmentDetailDrawer
        equipmentId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        canWrite={canWrite}
        onEdit={(row) => {
          setDetailId(null);
          openEdit(row);
        }}
      />

      <PvEquipmentFormDrawer
        open={formOpen}
        onOpenChange={setFormOpen}
        row={editRow}
        category={category}
        onSaved={(id) => setDetailId(id)}
        onEditExisting={(id) => setDetailId(id)}
      />
    </div>
  );
}
