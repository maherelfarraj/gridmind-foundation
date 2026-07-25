// P-076 — EVM workspace: KPIs + S-curve + capture flow.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, LineChart, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { captureEvmSnapshot } from "@/lib/evm.functions";
import { evmAccessQueryOptions, evmErrorMessage, evmSnapshotsQueryOptions } from "@/lib/evm.query";
import { buildEvmCsv, downloadCsv } from "@/lib/evm.csv";
import { EvmKpiStrip } from "@/components/finance/evm-kpi-strip";
import { EvmSCurve } from "@/components/finance/evm-s-curve";
import { CaptureEvmDialog } from "@/components/finance/capture-evm-dialog";

export const Route = createFileRoute("/_authenticated/projects/$projectId/finance/evm")({
  head: () => ({
    meta: [
      { title: "EVM — GridMind EPC" },
      {
        name: "description",
        content: "Earned value management: PV/EV/AC, SPI/CPI, EAC and immutable snapshot S-curve.",
      },
      { property: "og:title", content: "EVM — GridMind EPC" },
      {
        property: "og:description",
        content: "Lender-ready earned value performance: SPI, CPI, EAC vs BAC with an S-curve.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: EvmPending,
  errorComponent: EvmError,
  component: EvmPage,
});

function EvmPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const snapshots = useSuspenseQuery(evmSnapshotsQueryOptions(projectId));
  const access = useSuspenseQuery(evmAccessQueryOptions());

  const [captureOpen, setCaptureOpen] = useState(false);

  const captureFn = useServerFn(captureEvmSnapshot);
  const captureMut = useMutation({
    mutationFn: (input: { snapshotDate: string; includeAccruals: boolean }) =>
      captureFn({
        data: {
          projectId,
          snapshotDate: input.snapshotDate,
          includeAccruals: input.includeAccruals,
        },
      }),
    onSuccess: () => {
      toast.success("Snapshot captured");
      setCaptureOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["evm", "snapshots", projectId],
      });
    },
    onError: (e) => toast.error(evmErrorMessage(e)),
  });

  const rows = snapshots.data;
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Earned value</h2>
          <p className="text-sm text-muted-foreground">
            SPI/CPI computed from your WBS budgets and schedule progress. Snapshots are immutable
            audit records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(`evm-${projectId.slice(0, 8)}.csv`, buildEvmCsv(rows))}
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {access.data.canCapture ? (
            <Button size="sm" onClick={() => setCaptureOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Capture snapshot
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <LineChart className="h-8 w-8 text-muted-foreground" />
          <div>
            <div className="font-medium">No EVM snapshots yet</div>
            <p className="text-sm text-muted-foreground">
              Capture your first snapshot after budgets and PO commitments are imported.
            </p>
          </div>
          {access.data.canCapture ? (
            <Button onClick={() => setCaptureOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Capture snapshot
            </Button>
          ) : null}
        </Card>
      ) : (
        <>
          <EvmKpiStrip latest={latest} />
          <EvmSCurve rows={rows} />
        </>
      )}

      <CaptureEvmDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        projectId={projectId}
        submitting={captureMut.isPending}
        onCapture={async (input) => {
          await captureMut.mutateAsync(input);
        }}
      />
    </div>
  );
}

function EvmPending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function EvmError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="p-6">
      <div className="mb-2 font-medium">Couldn't load EVM data</div>
      <p className="mb-4 text-sm text-muted-foreground">{evmErrorMessage(error)}</p>
      <Button variant="outline" onClick={() => reset()}>
        Retry
      </Button>
    </Card>
  );
}
