// P-181 — Delivery tracking: status timeline with PO picker.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PackageCheck, Plus } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import { getFieldAccess, listDeliveries, upsertDelivery } from "@/lib/field-exec.functions";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUSES,
  type DeliveryStatus,
} from "@/lib/field-exec.rules";

export const Route = createFileRoute("/_authenticated/field/deliveries")({
  head: () => ({
    meta: [
      { title: "Site deliveries — GridMind EPC" },
      {
        name: "description",
        content: "Track inbound site deliveries against purchase orders with a status timeline.",
      },
      { property: "og:title", content: "Site deliveries — GridMind EPC" },
      {
        property: "og:description",
        content: "Expected, in-transit and delivered site consignments per project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeliveriesPage,
});

const STATUS_TONE: Record<DeliveryStatus, "default" | "secondary" | "outline" | "destructive"> = {
  expected: "outline",
  in_transit: "secondary",
  delivered: "default",
  partially_delivered: "secondary",
  rejected: "destructive",
};

function DeliveriesPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [reference, setReference] = useState("");
  const [poId, setPoId] = useState("none");
  const [expected, setExpected] = useState("");
  const [carrier, setCarrier] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getFieldAccess);
  const access = useQuery({ queryKey: ["field-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWrite ?? false;

  const listFn = useServerFn(listDeliveries);
  const key = ["deliveries", activeProject] as const;
  const data = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }),
    enabled: Boolean(activeProject),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const saveFn = useServerFn(upsertDelivery);
  const create = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          projectId: activeProject,
          purchaseOrderId: poId === "none" ? null : poId,
          reference: reference.trim() || null,
          status: "expected",
          expectedDate: expected || null,
          carrier: carrier.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Delivery added");
      setReference("");
      setExpected("");
      setCarrier("");
      setPoId("none");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const advance = useMutation({
    mutationFn: (v: { id: string; status: DeliveryStatus }) =>
      saveFn({ data: { id: v.id, projectId: activeProject, status: v.status } }),
    onSuccess: () => {
      toast.success("Delivery updated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deliveries = data.data?.deliveries ?? [];
  const pos = data.data?.purchaseOrders ?? [];
  const poLabel = (id: string | null) => {
    if (!id) return null;
    const po = pos.find((p) => p.id === id);
    return po ? `${po.po_number}${po.vendor_name ? ` · ${po.vendor_name}` : ""}` : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Site deliveries"
        description="Track inbound consignments against purchase orders from expected to delivered."
      />

      <ProjectSelect
        projects={projects.data ?? []}
        value={activeProject}
        onChange={setProjectId}
        loading={projects.isLoading}
      />

      {canWrite && activeProject ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New delivery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="dl-ref">Reference</Label>
              <Input
                id="dl-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="DN-1042"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dl-po">Purchase order</Label>
              <Select value={poId} onValueChange={setPoId}>
                <SelectTrigger id="dl-po">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No PO</SelectItem>
                  {pos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.po_number}
                      {p.vendor_name ? ` · ${p.vendor_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dl-exp">Expected date</Label>
              <Input
                id="dl-exp"
                type="date"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dl-carrier">Carrier</Label>
              <Input
                id="dl-carrier"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
            <div className="sm:col-span-4">
              <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Add delivery
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PanelState
        isLoading={data.isLoading}
        isError={data.isError}
        onRetry={() => data.refetch()}
        isEmpty={deliveries.length === 0}
        emptyTitle="No deliveries tracked"
        emptyDescription="Log expected consignments to follow them to site."
        emptyIcon={PackageCheck}
      >
        <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
          {deliveries.map((d) => (
            <li key={d.id} className="relative">
              <span
                className="absolute -left-[26px] top-4 size-2.5 rounded-full bg-primary"
                aria-hidden
              />
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {d.reference ?? "Unreferenced delivery"}
                      {poLabel(d.purchase_order_id) ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {poLabel(d.purchase_order_id)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.expected_date ? `Expected ${d.expected_date}` : "No expected date"}
                      {d.delivered_at ? ` · Delivered ${d.delivered_at.slice(0, 10)}` : ""}
                      {d.carrier ? ` · ${d.carrier}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_TONE[d.status as DeliveryStatus] ?? "outline"}>
                      {DELIVERY_STATUS_LABELS[d.status as DeliveryStatus] ?? d.status}
                    </Badge>
                    {canWrite ? (
                      <Select
                        value={d.status}
                        onValueChange={(v) =>
                          advance.mutate({ id: d.id, status: v as DeliveryStatus })
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-44"
                          aria-label={`Update status for ${d.reference ?? "delivery"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DELIVERY_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {DELIVERY_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </PanelState>
    </div>
  );
}
