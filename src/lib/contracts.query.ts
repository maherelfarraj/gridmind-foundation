// P-078 — TanStack Query options for contracts.
import { queryOptions } from "@tanstack/react-query";

import {
  getContract,
  getContractsAccess,
  listContracts,
} from "@/lib/contracts.functions";

export function contractsListQueryOptions(input: {
  projectId?: string;
  status?: string;
  contractType?: string;
  q?: string;
} = {}) {
  return queryOptions({
    queryKey: [
      "contracts",
      "list",
      input.projectId ?? null,
      input.status ?? null,
      input.contractType ?? null,
      input.q ?? null,
    ],
    queryFn: () => listContracts({ data: input }),
    staleTime: 30_000,
  });
}

export function contractDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["contracts", "detail", id],
    queryFn: () => getContract({ data: { id } }),
    staleTime: 15_000,
  });
}

export function contractsAccessQueryOptions() {
  return queryOptions({
    queryKey: ["contracts", "access"],
    queryFn: () => getContractsAccess(),
    staleTime: 60_000,
  });
}

export function contractErrorMessage(err: unknown): string {
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
