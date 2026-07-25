// P-097 — Certificate PDF smoke test.
import { describe, expect, it } from "vitest";
import { buildCertificatePdfBytes, sanitize } from "@/lib/exports/certificate-pdf";

describe("certificate-pdf", () => {
  it("sanitize decodes pre-encoded ampersands (O&M safety)", () => {
    expect(sanitize("O&amp;M")).toBe("O&M");
    expect(sanitize("Legal &amp; Co")).toBe("Legal & Co");
  });

  it("produces bytes and includes company name text (literal O&M)", () => {
    const bytes = buildCertificatePdfBytes({
      type: "cod",
      company: { name: "GridMind O&M Services", legalName: "GridMind O&M LLC" },
      project: { name: "Vega Solar", code: "VEGA-01" },
      branding: { primaryColor: null, accentColor: null, logoDataUrl: null },
      certificateNumber: "COD-0001",
      effectiveDate: "2026-06-15",
      scopeNotes: "All commissioning complete. O&M handover pending.",
      punchSummary: {
        A: { open: 0, closed: 3 },
        B: { open: 2, closed: 5 },
        C: { open: 4, closed: 1 },
      },
      prAtCod: 80.12,
      signatures: [],
      generatedAt: new Date().toISOString(),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("COD-0001");
    // Literal ampersand text should be embedded; encoded form must NOT be.
    expect(text).not.toContain("O&amp;M");
  });
});
