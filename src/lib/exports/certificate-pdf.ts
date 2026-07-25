// P-097 — Commissioning certificate PDF (client-side jsPDF, branded).
//
// Ampersands ("O&M team", "Owens & Minor Solar") render literally. We
// normalise any pre-encoded entities so "O&amp;M" round-trips to "O&M".
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

import {
  CERT_PARTY_LABELS,
  CERT_TYPE_LABELS,
  type CertificateType,
  type CertSignature,
} from "@/lib/commissioning-certificates.rules";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

export interface SignatureImage extends CertSignature {
  imageDataUrl: string | null;
}

export interface CertificatePdfInput {
  type: CertificateType;
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoDataUrl: string | null;
  };
  certificateNumber: string;
  effectiveDate: string | null;
  scopeNotes: string;
  punchSummary: Record<"A" | "B" | "C", { open: number; closed: number }> | null;
  prAtCod: number | null;
  signatures: SignatureImage[];
  generatedAt: string;
}

export function sanitize(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hexToRgb(
  hex: string | null | undefined,
  fallback: string,
): [number, number, number] {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  const raw = m ? m[1] : fallback.slice(1);
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export function buildCertificatePdfBytes(input: CertificatePdfInput): Uint8Array {
  const primary = hexToRgb(input.branding.primaryColor, DEFAULT_PRIMARY);
  const accent = hexToRgb(input.branding.accentColor, DEFAULT_ACCENT);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 48;

  // Header band
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 76, "F");
  if (input.branding.logoDataUrl) {
    try {
      doc.addImage(input.branding.logoDataUrl, "PNG", marginX, 18, 40, 40);
    } catch {
      /* ignore malformed logo */
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(sanitize(input.company.name), marginX + 52, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(sanitize(input.company.legalName ?? ""), marginX + 52, 52);
  doc.setFontSize(9);
  doc.text(
    `Generated ${fmtDate(input.generatedAt)}`,
    pageW - marginX,
    52,
    { align: "right" },
  );

  y = 108;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const title = `CERTIFICATE OF ${CERT_TYPE_LABELS[input.type].toUpperCase()}`;
  doc.text(sanitize(title), pageW / 2, y, { align: "center" });
  y += 12;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(1);
  doc.line(pageW / 2 - 80, y, pageW / 2 + 80, y);
  y += 24;

  // Meta grid
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const metaRows: [string, string][] = [
    ["Certificate No.", sanitize(input.certificateNumber)],
    ["Project", sanitize(`${input.project.name}${input.project.code ? ` (${input.project.code})` : ""}`)],
    ["Effective Date", fmtDate(input.effectiveDate)],
  ];
  for (const [k, v] of metaRows) {
    doc.setFont("helvetica", "bold");
    doc.text(k, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, marginX + 120, y);
    y += 16;
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Scope & Notes", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const scope = sanitize(input.scopeNotes || "—");
  const scopeLines = doc.splitTextToSize(scope, pageW - marginX * 2);
  doc.text(scopeLines, marginX, y);
  y += scopeLines.length * 12 + 8;

  if (input.type === "cod") {
    if (input.punchSummary) {
      autoTable(doc, {
        startY: y,
        head: [["Punch Category", "Open", "Closed"]],
        body: (["A", "B", "C"] as const).map((c) => [
          `Category ${c}`,
          String(input.punchSummary![c].open),
          String(input.punchSummary![c].closed),
        ]),
        margin: { left: marginX, right: marginX },
        headStyles: { fillColor: primary, textColor: [255, 255, 255] },
        styles: { fontSize: 9 },
      });
      y = (doc as any).lastAutoTable.finalY + 12;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Performance Ratio at COD:", marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(fmtPct(input.prAtCod), marginX + 180, y);
    y += 16;
  }

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Signatures", marginX, y);
  y += 12;

  // Signature blocks: 2 per row.
  const blockW = (pageW - marginX * 2 - 24) / 2;
  const blockH = 96;
  let col = 0;
  for (const s of input.signatures) {
    const x = marginX + col * (blockW + 24);
    if (y + blockH > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = 48;
    }
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(x, y, blockW, blockH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(sanitize(CERT_PARTY_LABELS[s.party]), x + 8, y + 14);
    if (s.imageDataUrl) {
      try {
        doc.addImage(s.imageDataUrl, "PNG", x + 8, y + 20, blockW - 16, 40);
      } catch {
        /* ignore */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(sanitize(s.name), x + 8, y + 74);
    doc.text(sanitize(s.title), x + 8, y + 86);
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(fmtDate(s.signed_at), x + blockW - 8, y + 86, { align: "right" });
    doc.setTextColor(0, 0, 0);

    col += 1;
    if (col === 2) {
      col = 0;
      y += blockH + 12;
    }
  }
  if (col !== 0) y += blockH + 12;

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 24;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.line(marginX, footerY - 12, pageW - marginX, footerY - 12);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    sanitize(`${input.company.name} • ${input.certificateNumber}`),
    marginX,
    footerY,
  );

  const out = doc.output("arraybuffer");
  return new Uint8Array(out as ArrayBuffer);
}
