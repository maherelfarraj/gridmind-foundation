// P-095 — Performance Ratio test report PDF (client-side jsPDF, branded).
//
// Ampersands ("O&M team") must render literally. jsPDF renders text via
// canvas ops and does NOT html-encode, but we still normalise inbound
// strings to strip any pre-encoded entities so "O&amp;M" round-trips as
// "O&M" in the final PDF.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

export interface PrReportInput {
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoDataUrl: string | null; // pre-fetched data URL
  };
  periodStart: string;
  periodEnd: string;
  meteredEnergyMwh: number;
  poaKwhPerM2: number;
  capacityMwp: number;
  contractPrPct: number;
  measuredPrPct: number;
  variancePct: number;
  notes: string | null;
  generatedAt: string; // ISO
}

function sanitize(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hexToRgb(hex: string | null | undefined, fallback: string): [number, number, number] {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  const raw = m ? m[1] : fallback.slice(1);
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
}

export function buildPrTestReportPdfBytes(input: PrReportInput): Uint8Array {
  const primary = hexToRgb(input.branding.primaryColor, DEFAULT_PRIMARY);
  const accent = hexToRgb(input.branding.accentColor, DEFAULT_ACCENT);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header band
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 96, "F");
  if (input.branding.logoDataUrl) {
    try {
      const fmt = input.branding.logoDataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
      doc.addImage(input.branding.logoDataUrl, fmt, margin, 22, 52, 52);
    } catch {
      /* ignore malformed logo */
    }
  }
  const xText = margin + (input.branding.logoDataUrl ? 66 : 0);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(sanitize(input.company.legalName || input.company.name), xText, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(sanitize(`Performance Ratio Test Report — ${input.project.name}`), xText, 64);
  doc.setFontSize(9);
  doc.text(sanitize(`${fmtDate(input.periodStart)} – ${fmtDate(input.periodEnd)}`), xText, 80);

  if (input.project.code) {
    doc.setFontSize(9);
    doc.text(sanitize(`Code ${input.project.code}`), pageW - margin, 40, {
      align: "right",
    });
  }

  doc.setTextColor(30, 30, 30);
  let y = 120;

  // KPI band: measured / contract / variance
  const kpis: Array<[string, string, "accent" | "muted" | "delta"]> = [
    ["Measured PR", `${fmtNum(input.measuredPrPct, 2)}%`, "accent"],
    ["Contract PR", `${fmtNum(input.contractPrPct, 2)}%`, "muted"],
    ["Variance", `${input.variancePct >= 0 ? "+" : ""}${fmtNum(input.variancePct, 2)}%`, "delta"],
  ];
  const boxW = (pageW - margin * 2 - 12) / 3;
  kpis.forEach(([label, value, tone], i) => {
    const x = margin + i * (boxW + 6);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(246, 247, 249);
    doc.roundedRect(x, y, boxW, 70, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), x + 12, y + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    if (tone === "accent") {
      doc.setTextColor(accent[0], accent[1], accent[2]);
    } else if (tone === "delta") {
      if (input.variancePct >= 0) doc.setTextColor(21, 128, 61);
      else doc.setTextColor(185, 28, 28);
    } else {
      doc.setTextColor(60, 60, 60);
    }
    doc.text(value, x + 12, y + 52);
  });
  y += 88;

  // Inputs & Method table
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Inputs & Method", margin, y);
  y += 6;

  autoTable(doc, {
    startY: y + 6,
    head: [["Parameter", "Value", "Unit"]],
    body: [
      ["Period start", fmtDate(input.periodStart), ""],
      ["Period end", fmtDate(input.periodEnd), ""],
      ["Metered energy", fmtNum(input.meteredEnergyMwh, 2), "MWh"],
      ["Plane-of-array insolation", fmtNum(input.poaKwhPerM2, 2), "kWh/m²"],
      ["Nominal DC capacity", fmtNum(input.capacityMwp, 3), "MWp"],
      ["Contract PR (per O&M contract)", fmtNum(input.contractPrPct, 2), "%"],
      ["Measured PR", fmtNum(input.measuredPrPct, 2), "%"],
    ].map((r) => r.map(sanitize)),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      1: { halign: "right" },
      2: { cellWidth: 70 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Formula", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(
    sanitize(
      "PR% = metered energy (MWh) / ( POA insolation (kWh/m²) × nominal DC capacity (MWp) ) × 100",
    ),
    margin,
    y,
  );
  y += 20;

  if (input.notes) {
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Notes", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(sanitize(input.notes), pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 10;
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, pageH - 44, pageW - margin, pageH - 44);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    sanitize(
      `Generated ${fmtDate(input.generatedAt)} · ${input.company.legalName || input.company.name}`,
    ),
    margin,
    pageH - 26,
  );

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
