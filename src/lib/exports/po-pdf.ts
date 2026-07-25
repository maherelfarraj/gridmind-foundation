// P-065 — Branded Purchase Order PDF builder (works server-side and in browser).
import {
  createDoc,
  createExportTheme,
  drawHeaderBand,
  drawFooters,
  drawTwoColumnBlock,
  docTable,
  docCaption,
  ensureSpace,
  numericCol,
  fmtMoney,
  fmtNum,
  fmtDate,
  sanitize,
  contentWidth,
  PAGE,
} from "@/lib/exports/theme";

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

export async function buildPoPdfBytes(input: PoPdfInput): Promise<Uint8Array> {
  const { po, vendor, project, company, branding } = input;
  const currency = po.currency_code || "USD";

  const theme = await createExportTheme(
    {
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      footerText: branding.footerText,
      logoSignedUrl: branding.logoSignedUrl,
    },
    company,
  );

  const doc = createDoc();
  const docTitle = "Purchase Order";
  const subtitle = `${sanitize(po.po_number)} · ${sanitize(po.status.replace("_", " ").toUpperCase())} · ${currency}`;
  const pageHeader = { title: docTitle, subtitle };
  let cursorY = drawHeaderBand(doc, theme, docTitle, subtitle);

  // Vendor / deliver-to two-column block
  cursorY = drawTwoColumnBlock(
    doc,
    theme,
    {
      title: "Vendor",
      lines: [sanitize(vendor?.name ?? "—"), sanitize(vendor?.address ?? "")].filter(Boolean),
    },
    {
      title: "Deliver to",
      lines: [sanitize(project?.name ?? "—"), sanitize(po.delivery_address ?? "")].filter(Boolean),
    },
    cursorY,
  );
  cursorY += 4;

  // Terms row
  cursorY = ensureSpace(doc, theme, cursorY, 60, "Purchase Order");
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      body: [
        ["Payment terms", sanitize(po.payment_terms ?? "—")],
        ["Incoterms", sanitize(po.incoterms ?? "—")],
        ["Required by", fmtDate(po.required_by_date)],
      ],
      columnStyles: {
        0: { fontStyle: "bold", textColor: [60, 60, 60] },
        1: numericCol,
      },
    }) + 14;

  // Line-item table
  cursorY = ensureSpace(doc, theme, cursorY, 100, "Purchase Order");
  const rows = po.lines.map((l) => [
    String(l.line_no),
    sanitize(l.description) + (l.spec ? `\n${sanitize(l.spec)}` : ""),
    fmtNum(l.qty, l.qty % 1 === 0 ? 0 : 2),
    sanitize(l.uom),
    fmtMoney(l.unit_price, currency),
    fmtMoney(l.amount, currency),
  ]);

  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      head: [["#", "Description", "Qty", "UoM", "Unit price", "Amount"]],
      body: rows,
      styles: { valign: "top" },
      columnStyles: {
        0: { cellWidth: 30, halign: "right" },
        2: { cellWidth: 48, halign: "right" },
        3: { cellWidth: 48 },
        4: { cellWidth: 90, halign: "right" },
        5: { cellWidth: 90, halign: "right" },
      },
    }) + 14;

  // Totals block via docTable — bold total row with 1.5pt top border.
  cursorY = ensureSpace(doc, theme, cursorY, 90, "Purchase Order");
  const width = contentWidth(doc);
  const totalsColW = 200;
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      body: [
        ["Subtotal", fmtMoney(po.subtotal, currency)],
        [`Tax (${Number(po.tax_pct || 0).toFixed(2)}%)`, fmtMoney(po.tax_amount, currency)],
        ["Total", fmtMoney(po.total_amount, currency)],
      ],
      tableWidth: totalsColW * 2,
      margin: { left: PAGE.margin + width - totalsColW * 2, right: PAGE.margin },
      theme: "plain",
      columnStyles: {
        0: { cellWidth: totalsColW },
        1: { cellWidth: totalsColW, halign: "right" },
      },
      totalRows: [2],
    }) + 10;

  if (po.issued_at) {
    docCaption(doc, `Issued ${fmtDate(po.issued_at)}`, cursorY);
  }

  drawFooters(doc, theme);

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

/** Convenience for browser downloads. */
export function poPdfFilename(poNumber: string): string {
  return `${(poNumber || "PO").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
}

export { sanitize as __sanitizePoText };
