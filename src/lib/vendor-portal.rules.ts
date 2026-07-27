// P-222 — Vendor portal pure rules (no I/O, unit-testable).

export const VENDOR_EXPOSURE_KEYS = [
  "pos",
  "deliveries",
  "invoices",
  "documents",
  "scorecard",
] as const;

export type VendorExposureKey = (typeof VENDOR_EXPOSURE_KEYS)[number];

export type VendorExposure = Record<VendorExposureKey, boolean>;

export const DEFAULT_VENDOR_EXPOSURE: VendorExposure = {
  pos: true,
  deliveries: true,
  invoices: true,
  documents: true,
  scorecard: false,
};

export const VENDOR_EXPOSURE_LABELS: Record<VendorExposureKey, string> = {
  pos: "Purchase orders",
  deliveries: "Deliveries",
  invoices: "Invoices",
  documents: "Documents",
  scorecard: "Scorecard",
};

export type VendorMembershipStatus = "invited" | "active" | "suspended" | "revoked";

export function normalizeVendorExposure(raw: unknown): VendorExposure {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_VENDOR_EXPOSURE };
  for (const k of VENDOR_EXPOSURE_KEYS) {
    if (typeof src[k] === "boolean") out[k] = src[k] as boolean;
  }
  return out;
}

/** Rate-limit bucket key for a vendor portal membership. */
export function vendorPortalRateKey(membershipId: string): string {
  return `vendor-portal:${membershipId}`;
}

export type VendorPortalErrorCode =
  | "vendor_portal_access_denied"
  | "vendor_portal_pos_not_exposed"
  | "vendor_portal_deliveries_not_exposed"
  | "vendor_portal_invoices_not_exposed"
  | "vendor_portal_documents_not_exposed"
  | "vendor_portal_rate_limited"
  | "comment_required"
  | "invalid_decision"
  | "po_not_found"
  | "po_not_acknowledgeable"
  | "unknown";

const KNOWN_CODES: VendorPortalErrorCode[] = [
  "vendor_portal_access_denied",
  "vendor_portal_pos_not_exposed",
  "vendor_portal_deliveries_not_exposed",
  "vendor_portal_invoices_not_exposed",
  "vendor_portal_documents_not_exposed",
  "vendor_portal_rate_limited",
  "comment_required",
  "invalid_decision",
  "po_not_found",
  "po_not_acknowledgeable",
];

/** Map a Postgres/RPC error into a typed vendor portal error code. */
export function vendorPortalErrorCode(err: unknown): VendorPortalErrorCode {
  const msg =
    err && typeof err === "object"
      ? String((err as { message?: unknown }).message ?? (err as { code?: unknown }).code ?? "")
      : String(err ?? "");
  for (const code of KNOWN_CODES) {
    if (msg.includes(code)) return code;
  }
  return "unknown";
}

export function isNotExposed(code: VendorPortalErrorCode): boolean {
  return code.endsWith("_not_exposed");
}

export function vendorPortalErrorMessage(code: VendorPortalErrorCode): string {
  switch (code) {
    case "vendor_portal_access_denied":
      return "Access expired or revoked";
    case "vendor_portal_pos_not_exposed":
      return "Purchase orders are not shared with your account";
    case "vendor_portal_deliveries_not_exposed":
      return "Deliveries are not shared with your account";
    case "vendor_portal_invoices_not_exposed":
      return "Invoices are not shared with your account";
    case "vendor_portal_documents_not_exposed":
      return "Documents are not shared with your account";
    case "vendor_portal_rate_limited":
      return "Too many requests — please slow down";
    case "comment_required":
      return "A comment is required for this decision";
    case "invalid_decision":
      return "That acknowledgment choice isn’t valid";
    case "po_not_found":
      return "Purchase order not found";
    case "po_not_acknowledgeable":
      return "This purchase order can no longer be acknowledged";
    default:
      return "Something went wrong loading your portal data";
  }
}

export interface VendorPoLike {
  status: string;
  required_by_date: string | null;
  acknowledged_at?: string | null;
}

export interface VendorOverview {
  openPos: number;
  pendingAcknowledgments: number;
  nextRequiredBy: string | null;
}

const OPEN_PO_STATUSES = new Set(["issued", "partially_received"]);

/** Derive the overview strip purely from the PO RPC payload. */
export function deriveVendorOverview(pos: readonly VendorPoLike[]): VendorOverview {
  let openPos = 0;
  let pendingAcknowledgments = 0;
  let nextRequiredBy: string | null = null;

  for (const po of pos) {
    const open = OPEN_PO_STATUSES.has(po.status);
    if (open) openPos += 1;
    if (po.status === "issued" && !po.acknowledged_at) pendingAcknowledgments += 1;
    if (open && po.required_by_date) {
      if (nextRequiredBy === null || po.required_by_date < nextRequiredBy) {
        nextRequiredBy = po.required_by_date;
      }
    }
  }

  return { openPos, pendingAcknowledgments, nextRequiredBy };
}

/** Invite expiry date for a given number of days. */
export function inviteExpiryDate(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Diff two exposure maps into a compact before/after audit payload. */
export function exposureDiff(
  before: VendorExposure,
  after: VendorExposure,
): Record<string, { before: boolean; after: boolean }> {
  const out: Record<string, { before: boolean; after: boolean }> = {};
  for (const k of VENDOR_EXPOSURE_KEYS) {
    if (before[k] !== after[k]) out[k] = { before: before[k], after: after[k] };
  }
  return out;
}

// ---------------------------------------------------------------------------
// P-223 — Purchase order acknowledgment helpers
// ---------------------------------------------------------------------------

/** Ordered lifecycle used by the vendor-facing status stepper. */
export const PO_STATUS_STEPS = ["issued", "partially_received", "received", "closed"] as const;
export type PoStatusStep = (typeof PO_STATUS_STEPS)[number];

export const PO_STATUS_LABELS: Record<PoStatusStep, string> = {
  issued: "Issued",
  partially_received: "Partially received",
  received: "Received",
  closed: "Closed",
};

export type AcknowledgmentStatus = "accepted" | "accepted_with_comments" | "rejected";

export const ACKNOWLEDGMENT_LABELS: Record<AcknowledgmentStatus, string> = {
  accepted: "Accepted",
  accepted_with_comments: "Accepted with comments",
  rejected: "Rejected",
};

/** A PO can only be acknowledged while it is still open for receipt. */
export function isAcknowledgeable(status: string): boolean {
  return status === "issued" || status === "partially_received";
}

/** True when the vendor decision requires a comment. */
export function requiresComment(decision: AcknowledgmentStatus): boolean {
  return decision === "accepted_with_comments" || decision === "rejected";
}

/** Client-side mirror of the RPC's comment guard. */
export function validateAcknowledgment(
  decision: AcknowledgmentStatus,
  comment: string | null | undefined,
): { ok: true } | { ok: false; code: "comment_required" } {
  if (requiresComment(decision) && !(comment ?? "").trim()) {
    return { ok: false, code: "comment_required" };
  }
  return { ok: true };
}

export interface CountdownChip {
  days: number;
  overdue: boolean;
  label: string;
}

/** Countdown chip for a required-by date (whole days, UTC-safe). */
export function countdownLabel(
  requiredBy: string | null | undefined,
  now: Date = new Date(),
): CountdownChip | null {
  if (!requiredBy) return null;
  const target = new Date(requiredBy);
  if (Number.isNaN(target.getTime())) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.ceil((target.getTime() - now.getTime()) / dayMs);
  if (days < 0) {
    const late = Math.abs(days);
    return { days, overdue: true, label: `${late} day${late === 1 ? "" : "s"} overdue` };
  }
  if (days === 0) return { days, overdue: false, label: "Due today" };
  return { days, overdue: false, label: `In ${days} day${days === 1 ? "" : "s"}` };
}

export interface PoLine {
  line_no: number;
  description: string;
  spec: string | null;
  quantity: number;
  uom: string | null;
  unit_price: number;
  amount: number;
  site_need_date: string | null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize the PO `lines` jsonb payload into display rows. */
export function parsePoLines(raw: unknown): PoLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    const l = (entry ?? {}) as Record<string, unknown>;
    const quantity = num(l.quantity ?? l.qty);
    const unitPrice = num(l.unit_price ?? l.unitPrice ?? l.rate);
    const lineNo = Number(l.line_no ?? l.lineNo);
    return {
      line_no: Number.isFinite(lineNo) && lineNo > 0 ? lineNo : i + 1,
      description: String(l.description ?? l.item ?? l.name ?? "Line item"),
      spec: (l.spec as string | null) ?? (l.specification as string | null) ?? null,
      quantity,
      uom: (l.uom as string | null) ?? (l.unit as string | null) ?? null,
      unit_price: unitPrice,
      amount: l.amount != null ? num(l.amount) : quantity * unitPrice,
      site_need_date: (l.site_need_date as string | null) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// P-224 — vendor-proposed delivery windows
// ---------------------------------------------------------------------------

export const VENDOR_PROPOSED_PREFIX = "Vendor-proposed";
export const COUNTER_PROPOSED_PREFIX = "Counter-proposed by procurement — ";

/** True when an expediting note was written by a vendor proposal. */
export function isVendorProposedNote(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.trimStart().startsWith(VENDOR_PROPOSED_PREFIX);
}

/** True when an expediting note was written by a procurement counter-proposal. */
export function isCounterProposedNote(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.trimStart().startsWith(COUNTER_PROPOSED_PREFIX);
}

export function counterProposedNote(comment: string): string {
  return `${COUNTER_PROPOSED_PREFIX}${comment.trim()}`;
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Client-side mirror of the RPC guard: a proposed date must be a valid ISO
 * date and never earlier than the PO issue date. Returns an error code or null.
 */
export function validateProposedDate(
  proposedDate: string | null | undefined,
  poIssueDate: string | null | undefined,
): "proposed_date_required" | "proposed_date_invalid" | "proposed_date_before_issue" | null {
  if (!proposedDate) return "proposed_date_required";
  if (!ISO_DATE_RE.test(proposedDate)) return "proposed_date_invalid";
  if (!poIssueDate) return null;
  const issue = poIssueDate.slice(0, 10);
  if (!ISO_DATE_RE.test(issue)) return null;
  return proposedDate < issue ? "proposed_date_before_issue" : null;
}

export const PROPOSE_DELIVERY_ERRORS: Record<string, string> = {
  proposed_date_required: "Pick a proposed delivery date.",
  proposed_date_invalid: "Enter a valid date (YYYY-MM-DD).",
  proposed_date_before_issue: "Date cannot be before the PO issue date.",
  line_not_on_po: "That line does not exist on this purchase order.",
  lines_required: "Add at least one line to propose.",
  deliveries_not_exposed: "Delivery scheduling is not shared with your account.",
};
