// P-202 — TanStack Query options for the bonds register.
import { queryOptions } from "@tanstack/react-query";

import { getBondInstrument, getBondsRegister } from "@/lib/bonds.functions";
import type { ListBondsInput } from "@/lib/bonds.rules";

export function bondsRegisterQueryOptions(filters: ListBondsInput) {
  return queryOptions({
    queryKey: ["bonds", "register", filters],
    queryFn: () => getBondsRegister({ data: filters }),
    staleTime: 10_000,
  });
}

export function bondDetailQueryOptions(instrumentId: string | null) {
  return queryOptions({
    queryKey: ["bonds", "detail", instrumentId],
    queryFn: () => getBondInstrument({ data: { instrument_id: instrumentId as string } }),
    enabled: Boolean(instrumentId),
    staleTime: 5_000,
  });
}

export function bondErrorMessage(err: unknown): string {
  if (!err) return "Something went wrong.";
  const body = (err as { body?: unknown }).body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as {
        message?: string;
        extra?: { blockers?: string[] };
      };
      const blockers = parsed.extra?.blockers;
      if (blockers?.length) return `${parsed.message ?? "Blocked"} ${blockers.join(" ")}`;
      if (parsed.message) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return (err as Error).message ?? "Something went wrong.";
}
