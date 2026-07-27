// P-216 — CSV paste import with zod-validated preview. Nothing inserts until confirmed.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/dpr-query";
import { importActivityCsv } from "@/lib/esg/activity.functions";
import { ESG_CATEGORY_LABEL, parseActivityCsv } from "@/lib/esg/activity.rules";

export function CsvImportDialog({
  open,
  onOpenChange,
  projectId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const importFn = useServerFn(importActivityCsv);

  const preview = useMemo(() => (text.trim() ? parseActivityCsv(text) : []), [text]);
  const valid = preview.filter((r) => r.ok && r.value);

  async function confirm() {
    if (valid.length === 0) return;
    setBusy(true);
    try {
      const res = (await importFn({
        data: {
          projectId,
          rows: valid.map((r) => ({
            category: r.value!.category,
            quantity: r.value!.quantity,
            unit: r.value!.unit,
            month: r.value!.month,
            hash: r.value!.hash,
          })),
        },
      })) as { created: number; skipped: number };
      toast.success(`CSV import — ${res.created} created, ${res.skipped} skipped`);
      setText("");
      onOpenChange(false);
      onImported();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from CSV paste</DialogTitle>
          <DialogDescription>
            One row per line: <code>category,quantity,unit,YYYY-MM</code>. Invalid rows are flagged
            and never inserted.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"fuel_diesel,1200,L,2026-07\nelectricity_grid,4500,kWh,2026-07"}
        />

        {preview.length > 0 ? (
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="text-muted-foreground">{row.line}</TableCell>
                    <TableCell>
                      {row.value ? ESG_CATEGORY_LABEL[row.value.category] : row.raw}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.value ? new Intl.NumberFormat("en-US").format(row.value.quantity) : "—"}
                    </TableCell>
                    <TableCell>{row.value?.unit ?? "—"}</TableCell>
                    <TableCell>{row.value?.month ?? "—"}</TableCell>
                    <TableCell>
                      {row.ok ? (
                        <Badge variant="secondary">Ready</Badge>
                      ) : (
                        <Badge variant="destructive">{row.error}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || valid.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Import {valid.length} row{valid.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
