// P-099 — Handover ceremony rules (pure, unit-tested).
import { z } from "zod";

export const HANDOVER_PREREQ_KEYS = [
  "cod_signed",
  "no_open_category_a_punch",
  "turnover_delivered",
  "ccc_signed",
] as const;
export type HandoverPrereqKey = (typeof HANDOVER_PREREQ_KEYS)[number];

export const HANDOVER_REASON_LABELS: Record<HandoverPrereqKey, string> = {
  cod_signed: "COD certificate must be signed",
  no_open_category_a_punch: "All Category A punch items must be closed",
  turnover_delivered: "Turnover pack must be delivered or accepted",
  ccc_signed: "Care, Custody & Control certificate must be signed",
};

export const HANDOVER_GATE_ITEM_KEYS = [
  "ccc_signed",
  "turnover_delivered",
  "punch_list_closed",
] as const;

export const HANDOVER_GATE_ITEM_LABELS: Record<
  (typeof HANDOVER_GATE_ITEM_KEYS)[number],
  string
> = {
  ccc_signed: "Care, Custody & Control certificate signed",
  turnover_delivered: "Turnover pack delivered",
  punch_list_closed: "Category A punch list closed",
};

// ---------------------------------------------------------------------------
// Server-fn input shapes
// ---------------------------------------------------------------------------
export const getHandoverBoardInput = z.object({
  projectId: z.string().uuid(),
});

export const signCccTransferInput = z.object({
  projectId: z.string().uuid(),
});
