// P-146 — React Query wiring for SLD governance.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getSldGovernance, transitionSldStatus } from "@/lib/sld-status.functions";
import type { SldStatus } from "@/lib/sld/status-machine";

const key = (drawingId: string) => ["sld-governance", drawingId] as const;

export function useSldGovernance(drawingId: string) {
  const fn = useServerFn(getSldGovernance);
  return useQuery(
    queryOptions({
      queryKey: key(drawingId),
      queryFn: () => (fn as any)({ data: { drawingId } }),
    }),
  );
}

export function useTransitionSldStatus(drawingId: string) {
  const fn = useServerFn(transitionSldStatus);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      target: SldStatus;
      comment?: string;
      metadata?: { replacement_drawing_id?: string };
    }) =>
      (fn as any)({
        data: {
          drawingId,
          target: vars.target,
          comment: vars.comment ?? "",
          metadata: vars.metadata ?? {},
        },
      }),
    onSuccess: async (res: any) => {
      toast.success(`Status moved to ${String(res?.to ?? "").replace("_", " ")}`);
      await qc.invalidateQueries({ queryKey: key(drawingId) });
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
      await qc.invalidateQueries({ queryKey: ["sld-revisions", drawingId] });
    },
    onError: async (err: unknown) => {
      const msg = String((err as { message?: string })?.message ?? "");
      toast.error(msg || "Transition denied.");
      await qc.invalidateQueries({ queryKey: key(drawingId) });
    },
  });
}
