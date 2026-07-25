// P-098 — Turnover pack index PDF (branded, client- or server-safe jsPDF).
//
// Ampersands render literally: "O&M" stays "O&M" (no "O&amp;M" and no
// "O&M;" HTML-entity artifact). sanitize() mirrors certificate-pdf.ts.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

export interface TurnoverPdfSectionItem {
  label: string;
  source: string;
  revision: string | null;
  document_date: string | null;
}

export interface TurnoverPdfSection {
  key: string;
  label: string;
  required: boolean;
  items: TurnoverPdfSectionItem[];
}

export interface TurnoverPdfInput {
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoDataUrl: string | null;
  };
  sections: TurnoverPdfSection[];
  compiledAt: string;
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
}

export function buildTurnoverIndexPdfBytes(input: TurnoverPdfInput): Uint8Array {
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
  doc.text(`Compiled ${fmtDate(input.compiledAt)}`, pageW - marginX, 52, {
    align: "right",
  });

  y = 108;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(sanitize("Turnover Package — Index"), pageW / 2, y, {
    align: "center",
  });
  y += 10;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(1.4);
  doc.line(marginX, y, pageW - marginX, y);

  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const projectLine = sanitize(
    `Project: ${input.project.name}${input.project.code ? ` (${input.project.code})` : ""}`,
  );
  doc.text(projectLine, marginX, y);
  y += 22;

  for (const section of input.sections) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.text(sanitize(section.label), marginX, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(sanitize(`${section.items.length} document(s)`), pageW - marginX, y, {
      align: "right",
    });
    y += 6;

    if (section.items.length === 0) {
      y += 12;
      doc.setTextColor(140, 140, 140);
      doc.setFontSize(10);
      doc.text(sanitize("— no documents in this section —"), marginX, y);
      y += 18;
      continue;
    }

    autoTable(doc, {
      startY: y + 4,
      margin: { left: marginX, right: marginX },
      head: [["Document", "Source", "Revision", "Date"]],
      body: section.items.map((i) => [
        sanitize(i.label),
        sanitize(i.source),
        sanitize(i.revision ?? "—"),
        sanitize(i.document_date ?? "—"),
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: {
        fillColor: [primary[0], primary[1], primary[2]],
        textColor: 255,
      },
      alternateRowStyles: { fillColor: [244, 245, 247] },
      columnStyles: {
        0: { cellWidth: 260 },
        2: { cellWidth: 60, halign: "center" },
        3: { cellWidth: 70, halign: "center" },
      },
    });
    // @ts-expect-error jspdf-autotable augments internal doc state.
    y = (doc.lastAutoTable?.finalY ?? y + 40) + 22;

    if (y > 720) {
      doc.addPage();
      y = 60;
    }
  }

  // Footer band
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 812, pageW, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(sanitize(`${input.company.name} • Turnover Package`), marginX, 830);
  doc.text(sanitize(fmtDate(input.compiledAt)), pageW - marginX, 830, {
    align: "right",
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
