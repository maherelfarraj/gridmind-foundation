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
  | "unknown";

const KNOWN_CODES: VendorPortalErrorCode[] = [
  "vendor_portal_access_denied",
  "vendor_portal_pos_not_exposed",
  "vendor_portal_deliveries_not_exposed",
  "vendor_portal_invoices_not_exposed",
  "vendor_portal_documents_not_exposed",
  "vendor_portal_rate_limited",
];

/** Map a Postgres/RPC error into a typed vendor portal error code. */
export function vendorPortalErrorCode(err: unknown): VendorPortalErrorCode {
  const msg =
    err && typeof err === "object"
      ? String(
          (err as { message?: unknown }).message ?? (err as { code?: unknown }).code ?? "",
        )
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
