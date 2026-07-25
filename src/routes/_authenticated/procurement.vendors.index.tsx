// P-061 — Vendor list page.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Plus, Search, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getVendorWriteAccess,
  listVendors,
  VENDOR_STATUSES,
  type VendorRow,
  type VendorStatus,
} from "@/lib/vendors.functions";
import { vendorWriteAccessQueryOptions, vendorsListQueryOptions } from "@/lib/vendors-query";

export const Route = createFileRoute("/_authenticated/procurement/vendors/")({
  head: () => ({
    meta: [
      { title: "Vendors — GridMind EPC" },
      {
        name: "description",
        content:
          "Manage GridMind EPC supplier master data — onboard vendors, capture commercial terms, and store certifications.",
      },
      { property: "og:title", content: "Vendors — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VendorsIndex,
  errorComponent: VendorsError,
});

function VendorsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load vendors</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button
        onClick={() => {
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: VendorStatus }) {
  const variant: Record<VendorStatus, "default" | "secondary" | "outline" | "destructive"> = {
    onboarding: "outline",
    active: "default",
    suspended: "secondary",
    blacklisted: "destructive",
  };
  return (
    <Badge variant={variant[status]} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}

function toCsv(rows: VendorRow[]): string {
  const header = [
    "name",
    "status",
    "categories",
    "payment_terms",
    "incoterms",
    "currency",
    "city",
    "country",
    "email",
    "created_at",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.name,
      r.status,
      r.categories.join("|"),
      r.payment_terms,
      r.incoterms,
      r.currency_code,
      r.city,
      r.country,
      r.email,
      r.created_at,
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(rows: VendorRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function VendorsIndex() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VendorStatus | "all">("all");
  const navigate = useNavigate();
  const listFn = useServerFn(listVendors);
  const accessFn = useServerFn(getVendorWriteAccess);

  const filters = useMemo(
    () => ({
      search: search.trim() || null,
      status: status === "all" ? null : status,
    }),
    [search, status],
  );

  const vendorsQuery = useSuspenseQuery(vendorsListQueryOptions(listFn, filters));
  const accessQuery = useSuspenseQuery(vendorWriteAccessQueryOptions(accessFn));
  const rows = vendorsQuery.data;
  const canWrite = accessQuery.data.canWrite;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Truck className="h-3.5 w-3.5" /> Procurement
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Supplier master — identity, commercial terms, and certifications.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {canWrite && (
            <Button asChild>
              <Link to="/procurement/vendors/new">
                <Plus className="mr-2 h-4 w-4" /> New vendor
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, tax ID, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {VENDOR_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {vendorsQuery.isFetching ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">
            No vendors yet — onboard your first vendor
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add supplier identity, payment terms, incoterms and certifications to start issuing
            RFQs.
          </p>
          {canWrite && (
            <Button className="mt-4" asChild>
              <Link to="/procurement/vendors/new">
                <Plus className="mr-2 h-4 w-4" /> Onboard vendor
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: "/procurement/vendors/$vendorId",
                      params: { vendorId: r.id },
                    })
                  }
                >
                  <TableCell>
                    <div className="font-medium text-foreground">{r.name}</div>
                    {r.legal_name && (
                      <div className="text-xs text-muted-foreground">{r.legal_name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.categories.slice(0, 3).map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">
                          {c}
                        </Badge>
                      ))}
                      {r.categories.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{r.categories.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {(r.payment_terms ?? "—").toUpperCase().replace("_", " ")} ·{" "}
                    {r.incoterms ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.currency_code ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[r.city, r.country].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
