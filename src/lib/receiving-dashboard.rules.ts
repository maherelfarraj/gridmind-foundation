// P-237 — Pure helpers for the receiving dashboard: ETA slippage against the
// site-need date and match-exception classification. Side-effect free.

export interface EtaRow {
  id: string;
  po_number: string | null;
  item_description: string;
  site_need_date: string | null;
  current_eta: string | null;
  eta_confirmed: boolean;
}

export type SlipSeverity = "on_time" | "at_risk" | "late" | "unknown";

export interface SlipResult {
  slip_days: number | null;
  severity: SlipSeverity;
}

const DAY = 24 * 60 * 60 * 1000;

function parseDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(String(value).slice(0, 10));
  return Number.isFinite(t) ? t : null;
}

/**
 * Positive slip = ETA lands after the site-need date. Anything within three
 * days of the need date is "at risk" so planners see it before it bites.
 */
export function etaSlippage(row: Pick<EtaRow, "site_need_date" | "current_eta">): SlipResult {
  const need = parseDay(row.site_need_date);
  const eta = parseDay(row.current_eta);
  if (need == null || eta == null) return { slip_days: null, severity: "unknown" };
  const slip = Math.round((eta - need) / DAY);
  if (slip > 0) return { slip_days: slip, severity: "late" };
  if (slip > -3) return { slip_days: slip, severity: "at_risk" };
  return { slip_days: slip, severity: "on_time" };
}

/** Rows sorted worst-first: latest slip on top, unknowns last. */
export function rankBySlippage<T extends Pick<EtaRow, "site_need_date" | "current_eta">>(
  rows: T[],
): Array<T & SlipResult> {
  return rows
    .map((r) => ({ ...r, ...etaSlippage(r) }))
    .sort((a, b) => {
      if (a.slip_days == null && b.slip_days == null) return 0;
      if (a.slip_days == null) return 1;
      if (b.slip_days == null) return -1;
      return b.slip_days - a.slip_days;
    });
}

export interface MatchExceptionRow {
  id: string;
  status: string;
  payment_release_blocked: boolean;
  amount_variance: number | null;
}

/** Match rows that hold up payment: blocked or explicitly flagged. */
export function matchExceptions<T extends MatchExceptionRow>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "variance_blocked" || r.payment_release_blocked);
}

export interface ReceivingCounts {
  open_receipts: number;
  match_exceptions: number;
  unconfirmed_etas: number;
  late_lines: number;
}

export function summarizeReceiving(args: {
  drafts: number;
  matches: MatchExceptionRow[];
  etas: EtaRow[];
}): ReceivingCounts {
  const ranked = rankBySlippage(args.etas);
  return {
    open_receipts: args.drafts,
    match_exceptions: matchExceptions(args.matches).length,
    unconfirmed_etas: args.etas.filter((e) => !e.eta_confirmed).length,
    late_lines: ranked.filter((r) => r.severity === "late").length,
  };
}
