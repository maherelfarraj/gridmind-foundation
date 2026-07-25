// P-079 — Change orders list (workflow lands in P-081+).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { upsertChangeOrder } from "@/lib/change-orders.functions";
import { changeOrdersListQueryOptions } from "@/lib/change-orders.query";
import { payAppErrorMessage } from "@/lib/pay-app.query";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/change-orders",
)({
  head: () => ({
    meta: [
      { title: "Change orders — GridMind EPC" },
      {
        name: "description",
        content:
          "Contract change orders with scope, cost, schedule impact, and approval routing.",
      },
      { property: "og:title", content: "Change orders — GridMind EPC" },
      {
        property: "og:description",
        content: "Track scope changes and their contract and schedule impact.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(changeOrdersListQueryOptions(params.projectId));
  },
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {payAppErrorMessage(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Project not found.</div>,
  component: ChangeOrdersPage,
});

function fmt(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function ChangeOrdersPage() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(changeOrdersListQueryOptions(projectId));
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Change orders</h1>
          <p className="text-sm text-muted-foreground">
            Log scope changes and their cost and schedule impact.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-4" /> New change order
        </Button>
      </div>

      <Card className="overflow-hidden">
        {list.data.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No change orders yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.co_number}</TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.schedule_impact_days > 0 ? "+" : ""}
                    {r.schedule_impact_days}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {open ? <NewCoDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function NewCoDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertChangeOrder);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("0");
  const [days, setDays] = useState("0");

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          project_id: projectId,
          title,
          description: description || null,
          amount: Number(amount || 0),
          schedule_impact_days: Number(days || 0),
          budget_impact: [],
        },
      }),
    onSuccess: async () => {
      toast.success("Change order created");
      await qc.invalidateQueries({ queryKey: ["change-orders", "list", projectId] });
      onClose();
    },
    onError: (err) => toast.error(payAppErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New change order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Schedule impact (days)</Label>
              <Input
                type="number"
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || title.trim().length === 0}
          >
            {mut.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
