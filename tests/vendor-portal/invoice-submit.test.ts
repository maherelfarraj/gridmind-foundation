// P-226 — vendor_portal_submit_invoice: exact P-067 insert + every rejection.
import { describe, expect, it, vi } from "vitest";

import { VENDOR_UPLOAD_MAX_BYTES } from "@/lib/vendor-uploads.rules";

// The scan placeholder is swappable so the quarantine branch is asserted.
const scanResult = { clean: true as boolean, reason: undefined as string | undefined };
vi.mock("@/lib/vendor-uploads.rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendor-uploads.rules")>();
  return { ...actual, scanVendorUpload: async () => scanResult };
});

import {
  COMPANY_A,
  COMPANY_B,
  createPortalHarness,
  makeMembership,
  makePo,
  PO_A,
  PO_B,
  USER_VENDOR_A,
  VENDOR_A,
  VENDOR_B,
} from "./fixtures";

const GOOD_PATH = `${COMPANY_A}/vendor-invoices/${VENDOR_A}/${PO_A}/1753600000000_inv.pdf`;
const PDF = { size: 1_024, type: "application/pdf" };

function base() {
  return {
    poId: PO_A,
    invoiceNumber: " INV-2026-0042 ",
    invoiceDate: "2026-07-20",
    amount: 61_250.5,
    currency: "JOD",
    filePath: GOOD_PATH,
  };
}

describe("happy path", () => {
  it("inserts a pending three_way_matches row with the P-067 columns", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    const id = h.rpc.submitInvoice(base());

    expect(h.db.three_way_matches).toHaveLength(1);
    expect(h.db.three_way_matches[0]).toEqual({
      id,
      company_id: COMPANY_A,
      po_id: PO_A,
      vendor_invoice_number: "INV-2026-0042",
      invoice_date: "2026-07-20",
      invoice_amount: 61_250.5,
      invoice_currency_code: "JOD",
      invoice_file_path: GOOD_PATH,
      status: "pending",
      created_by: USER_VENDOR_A,
    });
  });

  it("falls back to the PO currency and logs event + notifications + audit", () => {
    const h = createPortalHarness({ pos: [makePo({ currency_code: "USD" })] });
    const id = h.rpc.submitInvoice({ ...base(), currency: null });

    expect(h.db.three_way_matches[0].invoice_currency_code).toBe("USD");
    expect(h.db.vendor_portal_events[0]).toMatchObject({
      event: "vendor_portal.invoice_submitted",
      actor_type: "vendor",
      metadata: { po_id: PO_A, match_id: id },
    });
    expect(h.db.notifications.map((n) => n.user_id).sort()).toEqual([
      "user-proc-admin",
      "user-proc-officer",
    ]);
    expect(h.db.audit_logs[0]).toMatchObject({
      action: "vendor_portal.invoice_submitted",
      entity: "three_way_matches",
      entity_id: id,
    });
  });
});

describe("path validation", () => {
  const cases: Array<[string, string]> = [
    ["parent traversal", `${COMPANY_A}/vendor-invoices/${VENDOR_A}/../../secrets/inv.pdf`],
    ["wrong company prefix", `${COMPANY_B}/vendor-invoices/${VENDOR_A}/${PO_A}/inv.pdf`],
    ["wrong vendor folder", `${COMPANY_A}/vendor-invoices/${VENDOR_B}/${PO_A}/inv.pdf`],
    ["wrong PO folder", `${COMPANY_A}/vendor-invoices/${VENDOR_A}/${PO_B}/inv.pdf`],
    ["another bucket root", `documents/${COMPANY_A}/vendor-invoices/${VENDOR_A}/${PO_A}/inv.pdf`],
    ["empty", ""],
  ];

  for (const [label, filePath] of cases) {
    it(`rejects ${label} → invalid_file_path`, () => {
      const h = createPortalHarness({ pos: [makePo()] });
      expect(() => h.rpc.submitInvoice({ ...base(), filePath })).toThrow("invalid_file_path");
      expect(h.db.three_way_matches).toHaveLength(0);
    });
  }
});

describe("field validation", () => {
  it("amount ≤ 0 → invalid_amount", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    for (const amount of [0, -1, -0.01]) {
      expect(() => h.rpc.submitInvoice({ ...base(), amount })).toThrow("invalid_amount");
    }
  });

  it("blank invoice number → invoice_number_required", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    for (const invoiceNumber of ["", "   "]) {
      expect(() => h.rpc.submitInvoice({ ...base(), invoiceNumber })).toThrow(
        "invoice_number_required",
      );
    }
  });

  it("exposure.invoices=false and cross-vendor POs are denied", () => {
    const closed = createPortalHarness({
      memberships: [
        makeMembership({
          exposure: {
            pos: true,
            deliveries: true,
            invoices: false,
            documents: true,
            scorecard: false,
          },
        }),
      ],
      pos: [makePo()],
    });
    expect(() => closed.rpc.submitInvoice(base())).toThrow("invoices_not_exposed");

    const cross = createPortalHarness({ pos: [makePo({ vendor_id: VENDOR_B })] });
    expect(() => cross.rpc.submitInvoice(base())).toThrow("vendor_portal_access_denied");
  });
});

describe("server-fn upload gates", () => {
  it("enforces the 25 MB cap and PDF-only rule before the RPC runs", async () => {
    const h = createPortalHarness({ pos: [makePo()] });
    await expect(
      h.serverFn.submitInvoiceViaServerFn({
        ...base(),
        file: { size: VENDOR_UPLOAD_MAX_BYTES + 1, type: "application/pdf" },
      }),
    ).rejects.toThrow("file_too_large");
    await expect(
      h.serverFn.submitInvoiceViaServerFn({ ...base(), file: { size: 10, type: "image/png" } }),
    ).rejects.toThrow("invalid_mime");
    expect(h.db.three_way_matches).toHaveLength(0);
  });

  it("accepts a clean PDF and inserts exactly one match row", async () => {
    const h = createPortalHarness({ pos: [makePo()] });
    await h.serverFn.submitInvoiceViaServerFn({ ...base(), file: PDF });
    expect(h.db.three_way_matches).toHaveLength(1);
    expect(h.db.three_way_matches[0].invoice_file_path).toBe(GOOD_PATH);
  });

  it("a quarantined scan result refuses the insert", async () => {
    const h = createPortalHarness({ pos: [makePo()] });
    scanResult.clean = false;
    scanResult.reason = "eicar_test_signature";
    try {
      await expect(h.serverFn.submitInvoiceViaServerFn({ ...base(), file: PDF })).rejects.toThrow(
        "quarantined",
      );
    } finally {
      scanResult.clean = true;
      scanResult.reason = undefined;
    }
    expect(h.db.three_way_matches).toHaveLength(0);
    expect(h.db.vendor_portal_events).toHaveLength(0);
  });
});
