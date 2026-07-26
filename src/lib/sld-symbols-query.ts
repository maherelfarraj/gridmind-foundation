// P-139 — Symbol registry queries + mutations.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  deleteSymbolType,
  listSymbolTypes,
  upsertSymbolType,
  type SymbolRegistryPayload,
} from "@/lib/sld-symbols.functions";

export const SYMBOL_REGISTRY_KEY = ["sld-symbol-types"] as const;

export function useSymbolRegistry() {
  const fn = useServerFn(listSymbolTypes);
  return useQuery(
    queryOptions({
      queryKey: SYMBOL_REGISTRY_KEY,
      queryFn: () => (fn as any)() as Promise<SymbolRegistryPayload>,
      staleTime: 5 * 60 * 1000,
    }),
  );
}

export function useUpsertSymbolType(onDone?: () => void) {
  const fn = useServerFn(upsertSymbolType);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Record<string, unknown>) => (fn as any)({ data: vars }),
    onSuccess: async () => {
      toast.success("Symbol saved");
      onDone?.();
      await qc.invalidateQueries({ queryKey: SYMBOL_REGISTRY_KEY });
    },
    onError: (err: any) => toast.error(String(err?.message ?? "Failed to save symbol")),
  });
}

export function useDeleteSymbolType() {
  const fn = useServerFn(deleteSymbolType);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => (fn as any)({ data: { id } }),
    onSuccess: async () => {
      toast.success("Symbol override removed");
      await qc.invalidateQueries({ queryKey: SYMBOL_REGISTRY_KEY });
    },
    onError: (err: any) => toast.error(String(err?.message ?? "Failed to remove symbol")),
  });
}
