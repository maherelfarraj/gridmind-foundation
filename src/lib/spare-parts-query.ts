// P-070 — Query helpers for spare parts.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getSparePartsAccess,
  listSpareParts,
  listVendorsForParts,
} from "@/lib/spare-parts.functions";
import type { MaterialCategory } from "@/lib/procurement-extras-rules";

export function sparePartsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listSpareParts>>,
  filters: { search?: string | null; category?: MaterialCategory | null },
) {
  return queryOptions({
    queryKey: ["spare-parts", "list", filters],
    queryFn: () =>
      fn({
        data: {
          search: filters.search ?? null,
          category: filters.category ?? null,
        },
      }),
  });
}

export function sparePartsAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getSparePartsAccess>>,
) {
  return queryOptions({
    queryKey: ["spare-parts", "access"],
    queryFn: () => fn({}),
  });
}

export function sparePartsVendorsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listVendorsForParts>>,
) {
  return queryOptions({
    queryKey: ["spare-parts", "vendors"],
    queryFn: () => fn({}),
  });
}

export function errorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      /* ignore */
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}
