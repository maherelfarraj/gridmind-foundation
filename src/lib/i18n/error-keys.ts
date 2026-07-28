// P-241 — typed server error codes → translation keys. The server returns a
// stable machine code; the client renders the localized message with an English
// fallback when the code is unknown.
export const ERROR_KEY_MAP: Record<string, string> = {
  period_closed: "financeMod.errors.period_closed",
  finance_period_closed: "financeMod.errors.finance_period_closed",
  payment_release_blocked: "financeMod.errors.payment_release_blocked",
  gps_outside_geofence: "financeMod.errors.gps_outside_geofence",
  approval_instance_open: "financeMod.errors.approval_instance_open",
  hold_point_open: "fieldMod.errors.hold_point_open",
  open_hold_point: "fieldMod.errors.hold_point_open",
  vendor_portal_access_denied: "portalMod.errors.vendor_portal_access_denied",
  vendor_portal_pos_not_exposed: "portalMod.errors.vendor_portal_pos_not_exposed",
  vendor_portal_deliveries_not_exposed: "portalMod.errors.vendor_portal_deliveries_not_exposed",
  vendor_portal_invoices_not_exposed: "portalMod.errors.vendor_portal_invoices_not_exposed",
  vendor_portal_documents_not_exposed: "portalMod.errors.vendor_portal_documents_not_exposed",
  vendor_portal_rate_limited: "portalMod.errors.vendor_portal_rate_limited",
  comment_required: "portalMod.errors.comment_required",
  invalid_decision: "portalMod.errors.invalid_decision",
  po_not_found: "portalMod.errors.po_not_found",
  po_not_acknowledgeable: "portalMod.errors.po_not_acknowledgeable",
  proposed_date_required: "portalMod.errors.proposed_date_required",
  proposed_date_invalid: "portalMod.errors.proposed_date_invalid",
  proposed_date_before_issue: "portalMod.errors.proposed_date_before_issue",
  line_not_on_po: "portalMod.errors.line_not_on_po",
  lines_required: "portalMod.errors.lines_required",
  deliveries_not_exposed: "portalMod.errors.deliveries_not_exposed",
  file_required: "portalMod.errors.file_required",
  file_too_large: "portalMod.errors.file_too_large",
  invalid_mime: "portalMod.errors.invalid_mime",
  invalid_file_path: "portalMod.errors.invalid_file_path",
  invalid_amount: "portalMod.errors.invalid_amount",
  invoice_number_required: "portalMod.errors.invoice_number_required",
  title_required: "portalMod.errors.title_required",
  quarantined: "portalMod.errors.quarantined",
  po_required: "portalMod.errors.po_required",
};

export const UNKNOWN_ERROR_KEY = "financeMod.errors.unknown";

/** Maps a typed error code to its catalog key, or the unknown-error key. */
export function errorKeyFor(code: string | null | undefined): string {
  if (!code) return UNKNOWN_ERROR_KEY;
  return ERROR_KEY_MAP[code] ?? UNKNOWN_ERROR_KEY;
}

/**
 * Resolves a typed error to a localized message.
 * Falls back to the raw server message (English) when the code is unmapped.
 */
export function translateError(
  t: (key: string) => string,
  code: string | null | undefined,
  fallbackMessage?: string | null,
): string {
  if (code && ERROR_KEY_MAP[code]) return t(ERROR_KEY_MAP[code]);
  return fallbackMessage?.trim() || t(UNKNOWN_ERROR_KEY);
}

/** Pulls a typed code out of an unknown thrown value. */
export function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { code?: unknown; message?: unknown };
  if (typeof anyErr.code === "string") return anyErr.code;
  if (typeof anyErr.message === "string" && ERROR_KEY_MAP[anyErr.message]) return anyErr.message;
  return null;
}
