// P-224 — Shared vendor delivery-proposal mutation (optimistic + typed errors).
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { useI18n } from "@/lib/i18n/locale-provider";
import { translateError } from "@/lib/i18n/error-keys";
import { vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import {
  getVendorPortalLineEtas,
  proposeDelivery,
  type VendorLineEtaRow,
} from "@/lib/vendor-portal.functions";
import type { ProposeLineInput } from "@/components/vendor-portal/propose-delivery-dialog";

export function useVendorLineEtas(vendorId: string) {
  const etasFn = useServerFn(getVendorPortalLineEtas);
  const query = useQuery({
    queryKey: ["vendor-portal", "line-etas", vendorId] as const,
    queryFn: () => etasFn({ data: { vendorId } }),
    retry: false,
  });
  const etaByKey = useMemo(() => {
    const map = new Map<string, VendorLineEtaRow>();
    for (const e of query.data ?? []) map.set(`${e.po_id}:${e.po_line_no ?? 0}`, e);
    return map;
  }, [query.data]);
  return { query, etaByKey };
}

export function useProposeDelivery(vendorId: string, onDone?: () => void) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const proposeFn = useServerFn(proposeDelivery);
  const etasKey = ["vendor-portal", "line-etas", vendorId] as const;

  return useMutation({
    mutationFn: (vars: { poId: string; poIssueDate: string | null; lines: ProposeLineInput[] }) =>
      proposeFn({ data: { vendorId, ...vars } }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: etasKey });
      const prev = qc.getQueryData<VendorLineEtaRow[]>(etasKey);
      qc.setQueryData<VendorLineEtaRow[]>(etasKey, (old) => {
        const next = [...(old ?? [])];
        for (const l of vars.lines) {
          const i = next.findIndex((r) => r.po_id === vars.poId && r.po_line_no === l.line_no);
          const patch = {
            current_eta: l.proposed_date,
            eta_confirmed: false,
            notes: `Vendor-proposed${l.note ? ` — ${l.note}` : ""}`,
          };
          if (i >= 0) next[i] = { ...next[i], ...patch };
          else
            next.push({
              po_id: vars.poId,
              po_line_no: l.line_no,
              item_description: "",
              site_need_date: null,
              status: "on_track",
              updated_at: null,
              ...patch,
            });
        }
        return next;
      });
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(etasKey, ctx.prev);
      const code = vendorPortalErrorCode(e);
      toast.error(translateError(t, code, t("portalMod.propose.errorToast")));
    },
    onSuccess: (res) => {
      toast.success(t("portalMod.propose.successToast", { count: res.updated }));
      onDone?.();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: etasKey });
    },
  });
}
