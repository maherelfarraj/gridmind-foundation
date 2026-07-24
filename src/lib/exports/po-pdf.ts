// P-065 — Branded Purchase Order PDF builder (works server-side and in browser).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

export interface PoPdfBranding {
  primaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoSignedUrl: string | null;
}

export interface PoPdfInput {
  po: {
    id: string;
    po_number: string;
    status: string;
    currency_code: string;
    lines: Array<{
      line_no: number;
      description: string;
      spec: string | null;
      qty: number;
      uom: string;
      unit_price: number;
      amount: number;
      site_need_date: string | null;
    }>;
    subtotal: number;
    tax_pct: number;
    tax_amount: number;
    total_amount: number;
    payment_terms: string | null;
    incoterms: string | null;
    delivery_address: string | null;
    required_by_date: string | null;
    issued_at: string | null;
    created_at: string;
  };
  vendor: { name: string; address?: string | null } | null;
  project: { name: string | null } | null;
  company: {
    name: string;
    legal_name?: string | null;
    contact_email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  branding: PoPdfBranding;
}

/**
 * Undo any accidental HTML-entity escaping so text like "O&M" / "C&I" renders
 * correctly. Also strips the specific "&;" artifact we've seen from earlier
 * broken pipelines.
 */
function sanitize(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&;/g, "&");
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

function fmtMoney(n: unknown, currency: string): string {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
}

async function fetchLogoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = typeof btoa === "function" ? btoa(bin) : "";
    if (!base64) return null;
    const ct = res.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function buildPoPdfBytes(input: PoPdfInput): Promise<Uint8Array> {
  const { po, vendor, project, company, branding } = input;
  const primary = hexToRgb(branding.primaryColor, DEFAULT_PRIMARY);
  const accent = hexToRgb(branding.accentColor, DEFAULT_ACCENT);
  const currency = po.currency_code || "USD";
  const logo = await fetchLogoDataUrl(branding.logoSignedUrl);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header band
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 90, "F");
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, 22, 46, 46);
    } catch {
      // ignore malformed logo
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(sanitize(company.legal_name || company.name), margin + (logo ? 60 : 0), 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Purchase Order", margin + (logo ? 60 : 0), 60);

  // Right-side PO number + status
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(sanitize(po.po_number), pageW - margin, 42, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(sanitize(po.status.replace("_", " ").toUpperCase()), pageW - margin, 58, {
    align: "right",
  });
  doc.text(currency, pageW - margin, 72, { align: "right" });

  doc.setTextColor(30, 30, 30);
  let cursorY = 120;

  // Two-column meta rows: vendor / delivery
  const colW = (pageW - margin * 2 - 20) / 2;
  const leftLines = [
    "VENDOR",
    sanitize(vendor?.name ?? "—"),
    sanitize(vendor?.address ?? ""),
  ].filter((s, i) => i === 0 || s.length > 0);
  const rightLines = [
    "DELIVER TO",
    sanitize(project?.name ?? "—"),
    sanitize(po.delivery_address ?? ""),
  ].filter((s, i) => i === 0 || s.length > 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(leftLines[0], margin, cursorY);
  doc.text(rightLines[0], margin + colW + 20, cursorY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const startY = cursorY + 14;
  leftLines.slice(1).forEach((line, i) => {
    doc.text(line, margin, startY + i * 14, { maxWidth: colW });
  });
  rightLines.slice(1).forEach((line, i) => {
    doc.text(line, margin + colW + 20, startY + i * 14, { maxWidth: colW });
  });
  const metaHeight = Math.max(leftLines.length, rightLines.length) * 14;
  cursorY = startY + metaHeight + 12;

  // Terms row
  const termsRow = [
    ["Payment terms", sanitize(po.payment_terms ?? "—")],
    ["Incoterms", sanitize(po.incoterms ?? "—")],
    ["Required by", fmtDate(po.required_by_date)],
  ];
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, cursorY, pageW - margin, cursorY);
  cursorY += 12;
  const termsColW = (pageW - margin * 2) / 3;
  termsRow.forEach(([k, v], i) => {
    const x = margin + i * termsColW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(k.toUpperCase(), x, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(v, x, cursorY + 14, { maxWidth: termsColW - 10 });
  });
  cursorY += 36;

  // Lines table
  const rows = po.lines.map((l) => [
    String(l.line_no),
    sanitize(l.description) + (l.spec ? `\n${sanitize(l.spec)}` : ""),
    String(l.qty),
    sanitize(l.uom),
    fmtMoney(l.unit_price, currency),
    fmtMoney(l.amount, currency),
  ]);

  autoTable(doc, {
    startY: cursorY,
    head: [["#", "Description", "Qty", "UoM", "Unit price", "Amount"]],
    body: rows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 6, valign: "top" },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 30, halign: "right" },
      2: { cellWidth: 48, halign: "right" },
      3: { cellWidth: 48 },
      4: { cellWidth: 90, halign: "right" },
      5: { cellWidth: 90, halign: "right" },
    },
    alternateRowStyles: { fillColor: [246, 247, 249] },
  });

  // Totals block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterTable = (doc as any).lastAutoTable?.finalY ?? cursorY;
  let ty = afterTable + 16;
  const labelX = pageW - margin - 200;
  const valueX = pageW - margin;
  const totalsRows: Array<[string, string, boolean]> = [
    ["Subtotal", fmtMoney(po.subtotal, currency), false],
    [`Tax (${Number(po.tax_pct || 0).toFixed(2)}%)`, fmtMoney(po.tax_amount, currency), false],
    ["Total", fmtMoney(po.total_amount, currency), true],
  ];
  totalsRows.forEach(([label, value, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 12 : 10);
    doc.setTextColor(30, 30, 30);
    if (bold) {
      doc.setDrawColor(200, 200, 200);
      doc.line(labelX, ty - 8, valueX, ty - 8);
    }
    doc.text(label, labelX, ty);
    doc.text(value, valueX, ty, { align: "right" });
    ty += bold ? 20 : 16;
  });

  // Footer
  const footerText = sanitize(
    branding.footerText || `Generated by GridMind EPC · ${company.name}`,
  );
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(footerText, margin, pageH - 24);
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 24, {
      align: "right",
    });
    if (po.issued_at) {
      doc.text(
        `Issued ${fmtDate(po.issued_at)}`,
        pageW / 2,
        pageH - 24,
        { align: "center" },
      );
    }
  }

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

/** Convenience for browser downloads. */
export function poPdfFilename(poNumber: string): string {
  return `${(poNumber || "PO").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
}

export { sanitize as __sanitizePoText };
