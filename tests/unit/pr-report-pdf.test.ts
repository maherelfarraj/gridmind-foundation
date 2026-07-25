import { describe, expect, it } from "vitest";
import { buildPrTestReportPdfBytes } from "@/lib/exports/pr-test-report-pdf";

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

describe("buildPrTestReportPdfBytes", () => {
  const base = {
    company: { name: "Acme Solar", legalName: "Acme Solar & Storage Ltd." },
    project: { name: "Sunfield 175 MW", code: "SUN-175" },
    branding: {
      primaryColor: "#1e40af",
      accentColor: "#0d9488",
      logoDataUrl: null,
    },
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    meteredEnergyMwh: 25_000,
    poaKwhPerM2: 178.5,
    capacityMwp: 175,
    contractPrPct: 82,
    measuredPrPct: 80.03,
    variancePct: -2.4,
    notes: "Reviewed with O&M team on 2026-07-01.",
    generatedAt: "2026-07-25T00:00:00.000Z",
  };

  it("produces a non-empty PDF whose header bytes start with %PDF-", () => {
    const bytes = buildPrTestReportPdfBytes(base);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const head = decodeLatin1(bytes.subarray(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("renders literal ampersands (no HTML entities) for O&M / legal name", () => {
    const bytes = buildPrTestReportPdfBytes(base);
    const raw = decodeLatin1(bytes);
    // Ampersand must appear literally somewhere in the content stream.
    expect(raw).toContain("&");
    // No HTML-encoded ampersands anywhere in the file.
    expect(raw).not.toContain("&amp;");
    expect(raw).not.toContain("&#38;");
  });

  it("survives pre-encoded input by normalising &amp; back to &", () => {
    const bytes = buildPrTestReportPdfBytes({
      ...base,
      company: {
        name: "Acme &amp; Co",
        legalName: "Acme &amp; Co Ltd.",
      },
      notes: "Signed off by O&amp;M lead.",
    });
    const raw = decodeLatin1(bytes);
    expect(raw).not.toContain("&amp;");
    expect(raw).toContain("&");
  });
});
