// P-047 — Client-side branded proposal PDF builder.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";

export interface ProposalPdfData {
  proposal: any;
  lineItems: any[];
  opportunity: {
    name?: string | null;
    account_name?: string | null;
    expected_decision_date?: string | null;
  } | null;
  company: {
    name: string;
    legal_name?: string | null;
    contact_email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    footerText: string | null;
    logoSignedUrl: string | null;
  };
  yieldResult: any | null;
}

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

function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  const raw = m ? m[1] : DEFAULT_PRIMARY.slice(1);
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

async function fetchLogoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function slug(s: string, max = 40): string {
  return (
    (s || "untitled")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max) || "untitled"
  );
}

export function proposalPdfFilename(
  accountName: string | null | undefined,
  title: string | null | undefined,
  version: number | null | undefined,
): string {
  return `GridMind_Proposal_${slug(accountName ?? "Account")}_${slug(title ?? "Proposal")}_v${version ?? 1}.pdf`;
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

function fmtNum(n: unknown, digits = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(v);
}

export async function buildProposalPdf(
  data: ProposalPdfData,
): Promise<{ blob: Blob; filename: string }> {
  const { proposal, lineItems, opportunity, company, branding, yieldResult } = data;
  const currency = proposal.currency_code || "USD";
  const primary = hexToRgb(branding.primaryColor);
  const logoDataUrl = await fetchLogoDataUrl(branding.logoSignedUrl);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  const footerLabel = sanitize(branding.footerText || company.legal_name || company.name);

  const drawFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(footerLabel, margin, pageH - 20);
      doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 20, {
        align: "right",
      });
    }
    doc.setTextColor(0);
  };

  // --- Cover / header band ---
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 90, "F");

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", margin, 20, 120, 50, undefined, "FAST");
    } catch {
      // silently skip broken image
    }
  }

  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(sanitize(proposal.title || "Proposal"), pageW - margin, 45, {
    align: "right",
  });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`v${proposal.version ?? 1}`, pageW - margin, 65, { align: "right" });
  doc.setTextColor(0);

  let y = 120;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Prepared for", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(sanitize(opportunity?.account_name || opportunity?.name || "—"), margin + 90, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("Date", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(format(new Date(), "PP"), margin + 90, y);
  y += 16;
  if (proposal.valid_until) {
    doc.setFont("helvetica", "bold");
    doc.text("Valid until", margin, y);
    doc.setFont("helvetica", "normal");
    try {
      doc.text(format(parseISO(proposal.valid_until), "PP"), margin + 90, y);
    } catch {
      doc.text(sanitize(proposal.valid_until), margin + 90, y);
    }
    y += 16;
  }

  // --- Executive summary ---
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Executive summary", margin, y);
  y += 6;

  const array = (proposal.array_config as any) ?? {};
  const dcMw = Number(array.dc_capacity_kw ?? 0) / 1000;
  const summaryRows: Array<[string, string]> = [
    ["Archetype", sanitize(proposal.archetype ?? "—")],
    ["Capacity", dcMw > 0 ? `${fmtNum(dcMw, 2)} MW DC` : "—"],
    [
      "P50 energy (yr)",
      yieldResult?.p50_kwh != null ? `${fmtNum(yieldResult.p50_kwh, 0)} kWh` : "—",
    ],
    [
      "P90 energy (yr)",
      yieldResult?.p90_kwh != null ? `${fmtNum(yieldResult.p90_kwh, 0)} kWh` : "—",
    ],
    [
      "Specific yield",
      yieldResult?.specific_yield_kwh_kwp != null
        ? `${fmtNum(yieldResult.specific_yield_kwh_kwp, 0)} kWh/kWp`
        : "—",
    ],
  ];
  autoTable(doc, {
    startY: y + 4,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    body: summaryRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 130 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // --- Scope & pricing ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Scope & pricing", margin, y);

  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    head: [["Category", "Description", "Qty", "Unit", "Unit price", "Total"]],
    body: (lineItems ?? []).map((li: any) => [
      sanitize(li.category ?? ""),
      sanitize(li.description ?? ""),
      fmtNum(li.qty, 2),
      sanitize(li.unit ?? ""),
      fmtMoney(li.unit_price, currency),
      fmtMoney(li.line_total, currency),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: {
      fillColor: primary,
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      2: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  const contingencyAmt =
    (Number(proposal.subtotal ?? 0) * Number(proposal.contingency_pct ?? 0)) / 100;
  const totalsRows: Array<[string, string]> = [
    ["Subtotal", fmtMoney(proposal.subtotal, currency)],
    [`Contingency (${fmtNum(proposal.contingency_pct, 2)}%)`, fmtMoney(contingencyAmt, currency)],
    ["Total", fmtMoney(proposal.total, currency)],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: pageW - margin - 240, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    body: totalsRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: {
      0: { fontStyle: "bold", halign: "right", cellWidth: 140 },
      1: { halign: "right", cellWidth: 100 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // --- Yield summary ---
  if (y > pageH - 200) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Yield summary", margin, y);

  const yieldRows: Array<[string, string]> = [
    ["Engine", "gridmind-stub-v1 (placeholder)"],
    [
      "P50 energy (yr)",
      yieldResult?.p50_kwh != null ? `${fmtNum(yieldResult.p50_kwh, 0)} kWh` : "—",
    ],
    [
      "P90 energy (yr)",
      yieldResult?.p90_kwh != null ? `${fmtNum(yieldResult.p90_kwh, 0)} kWh` : "—",
    ],
    [
      "Specific yield",
      yieldResult?.specific_yield_kwh_kwp != null
        ? `${fmtNum(yieldResult.specific_yield_kwh_kwp, 0)} kWh/kWp`
        : "—",
    ],
    [
      "Performance ratio",
      yieldResult?.performance_ratio != null ? fmtNum(yieldResult.performance_ratio, 3) : "—",
    ],
  ];
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 4 },
    body: yieldRows.map((r) => [sanitize(r[0]), sanitize(r[1])]),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 160 },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  const monthly: number[] = Array.isArray(yieldResult?.monthly) ? yieldResult.monthly : [];
  if (monthly.length === 12) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [months],
      body: [monthly.map((v) => fmtNum(v, 0))],
      styles: { fontSize: 8, halign: "right", cellPadding: 3 },
      headStyles: {
        fillColor: primary,
        textColor: 255,
        halign: "right",
      },
    });
    y = (doc as any).lastAutoTable.finalY + 20;
  }

  // --- Terms ---
  if (y > pageH - 160) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Terms", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const termLines: string[] = [
    `Currency: ${sanitize(currency)}`,
    proposal.valid_until
      ? `Validity: quote valid until ${(() => {
          try {
            return format(parseISO(proposal.valid_until), "PP");
          } catch {
            return sanitize(proposal.valid_until);
          }
        })()}.`
      : "Validity: see cover.",
  ];
  for (const line of termLines) {
    doc.text(sanitize(line), margin, y);
    y += 14;
  }
  if (proposal.notes) {
    y += 6;
    const notes = doc.splitTextToSize(sanitize(proposal.notes), pageW - 2 * margin);
    doc.text(notes, margin, y);
    y += notes.length * 12;
  }

  drawFooter();

  const blob = doc.output("blob");
  const filename = proposalPdfFilename(opportunity?.account_name, proposal.title, proposal.version);
  return { blob, filename };
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
