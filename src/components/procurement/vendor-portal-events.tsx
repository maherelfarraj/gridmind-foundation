// P-226 — Internal vendor portal events viewer: server-filtered, paginated,
// append-only, CSV export gated to procurement_admin / company_admin.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { Download, Lock } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatDateTime } from "@/lib/format";
import {
  EVENTS_PAGE_SIZE,
  exportVendorPortalEvents,
  listVendorPortalEvents,
  type VendorPortalEventRow,
} from "@/lib/vendor-portal.functions";

const EVENT_TYPES = [
  "vendor_portal.invited",
  "vendor_portal.accepted",
  "vendor_portal.suspended",
  "vendor_portal.revoked",
  "vendor_portal.reactivated",
  "vendor_portal.exposure_changed",
  "vendor_portal.pos_viewed",
  "vendor_portal.po_acknowledged",
  "vendor_portal.delivery_proposed",
  "vendor_portal.invoice_submitted",
  "vendor_portal.document_downloaded",
  "vendor_portal.events_exported",
] as const;

const RANGES = [
  { value: "all", label: "All time", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
] as const;

function eventLabel(event: string) {
  return event.replace("vendor_portal.", "").replace(/_/g, " ");
}

export function VendorPortalEvents({
  vendorId,
  canExport,
}: {
  vendorId: string;
  canExport: boolean;
}) {
  const listFn = useServerFn(listVendorPortalEvents);
  const exportFn = useServerFn(exportVendorPortalEvents);

  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("all");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<VendorPortalEventRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(() => {
    const days = RANGES.find((r) => r.value === range)?.days ?? null;
    return {
      vendorId,
      events: selected.length ? selected : undefined,
      from: days ? startOfDay(subDays(new Date(), days)).toISOString() : undefined,
      to: days ? endOfDay(new Date()).toISOString() : undefined,
    };
  }, [vendorId, selected, range]);

  const events = useQuery({
    queryKey: ["vendor-portal", "events", filters, page],
    queryFn: () => listFn({ data: { ...filters, page, pageSize: EVENTS_PAGE_SIZE } }),
  });

  const total = events.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / EVENTS_PAGE_SIZE));
  const rows = events.data?.rows ?? [];

  const toggle = (evt: string) => {
    setPage(0);
    setSelected((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const res = await exportFn({ data: { ...filters, page: 0, pageSize: EVENTS_PAGE_SIZE } });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vendor-portal-events-${vendorId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${res.rowCount} event(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export events");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Portal activity</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Event type{selected.length ? ` (${selected.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {EVENT_TYPES.map((evt) => (
                <DropdownMenuCheckboxItem
                  key={evt}
                  checked={selected.includes(evt)}
                  onCheckedChange={() => toggle(evt)}
                  className="capitalize"
                >
                  {eventLabel(evt)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select
            value={range}
            onValueChange={(v) => {
              setPage(0);
              setRange(v as typeof range);
            }}
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canExport ? (
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void onExport()}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Events are append-only and cannot be edited.
        </div>

        {events.isLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        ) : events.error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn’t load portal activity.</p>
            <Button variant="outline" size="sm" onClick={() => void events.refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No vendor portal activity yet.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(e.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {eventLabel(e.event)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {e.actor_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.actor_email ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(e)}>
                        Metadata
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {total} event{total === 1 ? "" : "s"} · page {page + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">
              {detail ? eventLabel(detail.event) : "Event"}
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(detail?.metadata ?? {}, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
