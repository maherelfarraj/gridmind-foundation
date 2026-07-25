// P-076 — TanStack Query hooks for EVM.
import { queryOptions } from "@tanstack/react-query";
import { getEvmAccess, listEvmSnapshots, type EvmSnapshotRow } from "@/lib/evm.functions";

export function evmSnapshotsQueryOptions(projectId: string) {
  return queryOptions<EvmSnapshotRow[]>({
    queryKey: ["evm", "snapshots", projectId],
    queryFn: () => listEvmSnapshots({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function evmAccessQueryOptions() {
  return queryOptions<{ canCapture: boolean }>({
    queryKey: ["evm", "access"],
    queryFn: () => getEvmAccess(),
    staleTime: 60_000,
  });
}

export function evmErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return p.message;
      if (p?.error) return p.error;
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}
