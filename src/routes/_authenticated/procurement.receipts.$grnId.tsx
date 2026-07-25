// P-066 — Goods Receipt detail (read-only).
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, PackageOpen } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GrnStatusBadge } from "@/components/procurement/grn-status-badge";
import { getGrn } from "@/lib/grn.functions";
import { grnDetailQueryOptions } from "@/lib/grn-query";

export const Route = createFileRoute("/_authenticated/procurement/receipts/$grnId")({
  head: () => ({
    meta: [
      { title: "Goods Receipt — GridMind EPC" },
      {
        name: "description",
        content: "View a confirmed goods receipt: lines, lot IDs, defects, and photos.",
      },
    ],
  }),
  component: GrnDetail,
});

function GrnDetail() {
  const { grnId } = useParams({
    from: "/_authenticated/procurement/receipts/$grnId",
  });
  const navigate = useNavigate();
  const fn = useServerFn(getGrn);
  const query = useSuspenseQuery(grnDetailQueryOptions(fn, grnId));
  const grn = query.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/receipts" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to receipts
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <PackageOpen className="h-3.5 w-3.5" /> Procurement · GRN
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{grn.grn_number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <GrnStatusBadge status={grn.status} />
            {grn.po_number && (
              <>
                <span>·</span>
                <Link
                  to="/procurement/pos/$poId"
                  params={{ poId: grn.po_id }}
                  className="underline-offset-4 hover:underline"
                >
                  PO {grn.po_number}
                </Link>
              </>
            )}
            {grn.vendor_name && (
              <>
                <span>·</span>
                <span>{grn.vendor_name}</span>
              </>
            )}
            {grn.received_at && (
              <>
                <span>·</span>
                <span>Received {format(new Date(grn.received_at), "PPp")}</span>
              </>
            )}
          </div>
        </div>
        <Badge variant="outline">
          Defects: <span className="ml-1 font-mono">{grn.defects_count}</span>
        </Badge>
      </header>

      <section className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Lot IDs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grn.lines.map((l) => (
              <TableRow key={l.po_line_no}>
                <TableCell className="font-mono text-xs">#{l.po_line_no}</TableCell>
                <TableCell>
                  <div>{l.description}</div>
                  {l.defect_notes && (
                    <div className="text-xs text-destructive">{l.defect_notes}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {l.qty_ordered} {l.uom}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {l.qty_received} {l.uom}
                </TableCell>
                <TableCell className="capitalize">{l.condition}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {l.lot_ids.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      l.lot_ids.map((id) => (
                        <Badge key={id} variant="secondary" className="font-mono text-xs">
                          {id}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {grn.notes && (
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{grn.notes}</p>
        </section>
      )}

      {grn.photos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Photos</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {grn.photos.map((p, i) => {
              const url = grn.photo_urls[i];
              return (
                <a
                  key={p}
                  href={url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-square overflow-hidden rounded-md border border-border bg-muted"
                >
                  {url ? (
                    <img src={url} alt="Delivery" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Unavailable
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
