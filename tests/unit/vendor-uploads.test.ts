// P-225 — vendor upload path/size/scan rules.
import { describe, expect, it } from "vitest";

import {
  isInsideDocPrefix,
  isInsideInvoicePrefix,
  safeFileName,
  scanVendorUpload,
  validateUploadFile,
  vendorDocPath,
  vendorInvoicePath,
  VENDOR_DOC_ALLOWED_MIME,
  VENDOR_INVOICE_MIME,
  VENDOR_UPLOAD_MAX_BYTES,
} from "@/lib/vendor-uploads.rules";

const CO = "11111111-1111-1111-1111-111111111111";
const V = "22222222-2222-2222-2222-222222222222";
const PO = "33333333-3333-3333-3333-333333333333";

describe("safeFileName", () => {
  it("strips directories and unsafe characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("Invoice #42 (final).pdf")).toBe("Invoice__42__final_.pdf");
    expect(safeFileName("")).toBe("file");
  });
});

describe("storage paths", () => {
  it("builds company-UUID-first invoice paths inside the PO prefix", () => {
    const path = vendorInvoicePath(CO, V, PO, "inv.pdf", 1700000000000);
    expect(path).toBe(`${CO}/vendor-invoices/${V}/${PO}/1700000000000_inv.pdf`);
    expect(isInsideInvoicePrefix(path, CO, V, PO)).toBe(true);
  });

  it("rejects paths for another vendor, company or PO", () => {
    const path = vendorInvoicePath(CO, V, PO, "inv.pdf");
    expect(isInsideInvoicePrefix(path, CO, V, "44444444-4444-4444-4444-444444444444")).toBe(false);
    expect(isInsideInvoicePrefix(path, V, V, PO)).toBe(false);
    expect(isInsideInvoicePrefix(`${CO}/vendor-invoices/${V}/${PO}/../x.pdf`, CO, V, PO)).toBe(
      false,
    );
  });

  it("builds and validates document paths", () => {
    const path = vendorDocPath(CO, V, "datasheet.pdf", 1);
    expect(path).toBe(`${CO}/vendor-docs/${V}/1_datasheet.pdf`);
    expect(isInsideDocPrefix(path, CO, V)).toBe(true);
    expect(isInsideDocPrefix(path, CO, PO)).toBe(false);
  });
});

describe("validateUploadFile", () => {
  it("requires a file", () => {
    expect(validateUploadFile(null, [VENDOR_INVOICE_MIME])).toBe("file_required");
  });

  it("caps size at 25 MB", () => {
    expect(
      validateUploadFile({ size: VENDOR_UPLOAD_MAX_BYTES + 1, type: VENDOR_INVOICE_MIME }, [
        VENDOR_INVOICE_MIME,
      ]),
    ).toBe("file_too_large");
  });

  it("only accepts PDFs for invoices but more types for documents", () => {
    expect(validateUploadFile({ size: 10, type: "image/png" }, [VENDOR_INVOICE_MIME])).toBe(
      "invalid_mime",
    );
    expect(validateUploadFile({ size: 10, type: "image/png" }, VENDOR_DOC_ALLOWED_MIME)).toBeNull();
    expect(
      validateUploadFile({ size: 10, type: VENDOR_INVOICE_MIME }, [VENDOR_INVOICE_MIME]),
    ).toBeNull();
  });
});

describe("scanVendorUpload placeholder", () => {
  it("passes normal files and quarantines oversized ones", async () => {
    await expect(
      scanVendorUpload({ path: "a", size: 1024, mimeType: VENDOR_INVOICE_MIME }),
    ).resolves.toEqual({ clean: true });
    const bad = await scanVendorUpload({
      path: "a",
      size: VENDOR_UPLOAD_MAX_BYTES + 1,
      mimeType: VENDOR_INVOICE_MIME,
    });
    expect(bad.clean).toBe(false);
  });
});
