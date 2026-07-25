// P-091 — Transmittal detail with send / acknowledge actions.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ackTransmittal, sendTransmittal } from "@/lib/transmittals.functions";
import { errorMessage, transmittalDetailQueryOptions } from "@/lib/transmittals-query";
import { TRANSMITTAL_DIRECTION_LABELS, isTransmittalOverdue } from "@/lib/transmittals.rules";

export const Route = createFileRoute("/_authenticated/field/transmittals/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Transmittal ${params.id.slice(0, 8)} — GridMind EPC` },
      { name: "description", content: "Transmittal detail with item list and acknowledgement." },
      { property: "og:title", content: "Transmittal detail — GridMind EPC" },
      {
        property: "og:description",
        content: "Send an outgoing transmittal or record acknowledgement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TransmittalDetailPage,
});

function TransmittalDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const query = useQuery(transmittalDetailQueryOptions(id));

  const sendMut = useMutation({
    mutationFn: () => sendTransmittal({ data: { id } }),
    onSuccess: async () => {
      toast.success("Marked as sent");
      await qc.invalidateQueries({ queryKey: ["transmittals"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ackMut = useMutation({
    mutationFn: () => ackTransmittal({ data: { id } }),
    onSuccess: async () => {
      toast.success("Acknowledged");
      await qc.invalidateQueries({ queryKey: ["transmittals"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load transmittal</AlertTitle>
          <AlertDescription>{errorMessage(query.error) || "Not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { transmittal, permissions } = query.data;
  const overdue = isTransmittalOverdue(transmittal);
  const canWrite = permissions.canWrite;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-24 md:p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/field/transmittals"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to transmittals
        </Link>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Send size={14} aria-hidden /> Transmittal
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {transmittal.transmittal_number}
          </h1>
          <Badge variant="outline">{TRANSMITTAL_DIRECTION_LABELS[transmittal.direction]}</Badge>
          {overdue ? (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" /> Overdue
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{transmittal.subject}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Project</span>
            <div>{transmittal.project_name ?? "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Response due</span>
            <div>{transmittal.response_due ?? "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">From</span>
            <div>{transmittal.from_party}</div>
          </div>
          <div>
            <span className="text-muted-foreground">To</span>
            <div>{transmittal.to_party}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Sent</span>
            <div>{transmittal.sent_at ? new Date(transmittal.sent_at).toLocaleString() : "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Acknowledged</span>
            <div>
              {transmittal.acknowledged_at
                ? new Date(transmittal.acknowledged_at).toLocaleString()
                : "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items ({transmittal.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead className="text-right">Copies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transmittal.items.map((it, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm">{it.description}</TableCell>
                  <TableCell className="text-sm">{it.revision ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm">{it.copies}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-end gap-2">
            {!transmittal.sent_at ? (
              <Button onClick={() => sendMut.mutate()} disabled={sendMut.isPending}>
                {sendMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Mark as sent
              </Button>
            ) : null}
            {!transmittal.acknowledged_at ? (
              <Button variant="outline" onClick={() => ackMut.mutate()} disabled={ackMut.isPending}>
                {ackMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Record acknowledgement
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
