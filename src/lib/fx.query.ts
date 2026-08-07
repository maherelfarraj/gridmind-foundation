// FX-01 — TanStack Query options for FX Rate Management.
import { queryOptions } from "@tanstack/react-query";

import { getFxAdminData } from "@/lib/fx.functions";

export function fxAdminQueryOptions() {
  return queryOptions({
    queryKey: ["fx", "admin"],
    queryFn: () => getFxAdminData(),
    staleTime: 15_000,
  });
}

export function fxErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return String(p.message);
      if (p?.error) return String(p.error);
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}
