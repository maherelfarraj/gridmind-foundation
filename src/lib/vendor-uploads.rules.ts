// P-225 — Vendor portal upload rules (client + server share this module).
//
// Pure helpers: path construction/validation, size + MIME caps, and the
// virus-scan placeholder. No Supabase imports — safe in both bundles.

export const VENDOR_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const VENDOR_INVOICE_MIME = "application/pdf";
export const VENDOR_DOC_ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type VendorUploadErrorCode =
  | "file_required"
  | "file_too_large"
  | "invalid_mime"
  | "invalid_file_path"
  | "invalid_amount"
  | "invoice_number_required"
  | "title_required"
  | "quarantined";

export const VENDOR_UPLOAD_ERRORS: Record<VendorUploadErrorCode, string> = {
  file_required: "Attach a file first.",
  file_too_large: "Files must be 25 MB or smaller.",
  invalid_mime: "Unsupported file type.",
  invalid_file_path: "That storage location is not allowed.",
  invalid_amount: "Amount must be greater than zero.",
  invoice_number_required: "Enter your invoice number.",
  title_required: "Give the document a title.",
  quarantined: "The file failed the security scan and was not accepted.",
};

/** Strip anything that could escape the vendor's storage prefix. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 180) || "file";
}

export function vendorInvoicePath(
  companyId: string,
  vendorId: string,
  poId: string,
  filename: string,
  stamp = Date.now(),
): string {
  return `${companyId}/vendor-invoices/${vendorId}/${poId}/${stamp}_${safeFileName(filename)}`;
}

export function vendorDocPath(
  companyId: string,
  vendorId: string,
  filename: string,
  stamp = Date.now(),
): string {
  return `${companyId}/vendor-docs/${vendorId}/${stamp}_${safeFileName(filename)}`;
}

/** Mirror of the RPC's `like` guard — keeps bad paths out before the round trip. */
export function isInsideInvoicePrefix(
  path: string,
  companyId: string,
  vendorId: string,
  poId: string,
): boolean {
  const prefix = `${companyId}/vendor-invoices/${vendorId}/${poId}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("..");
}

export function isInsideDocPrefix(path: string, companyId: string, vendorId: string): boolean {
  const prefix = `${companyId}/vendor-docs/${vendorId}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("..");
}

export function validateUploadFile(
  file: { size: number; type: string } | null | undefined,
  allowedMime: readonly string[],
): VendorUploadErrorCode | null {
  if (!file) return "file_required";
  if (file.size > VENDOR_UPLOAD_MAX_BYTES) return "file_too_large";
  if (!allowedMime.includes(file.type)) return "invalid_mime";
  return null;
}

export interface ScanResult {
  clean: boolean;
  reason?: string;
}

/**
 * Virus-scan placeholder. Non-clean results quarantine the upload: callers
 * MUST refuse the three-way-match / document insert when `clean` is false.
 *
 * TODO: wire ClamAV / VirusTotal via a scanning route and replace this stub.
 */
export async function scanVendorUpload(input: {
  path: string;
  size: number;
  mimeType: string;
}): Promise<ScanResult> {
  if (input.size > VENDOR_UPLOAD_MAX_BYTES) {
    return { clean: false, reason: "file_too_large" };
  }
  return { clean: true };
}
