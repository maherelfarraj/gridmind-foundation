// P-047 — Client-side branded proposal PDF builder.
import {
  contentWidth,
  createDoc,
  createExportTheme,
  docBody,
  docH1,
  docH2,
  docTable,
  downloadBlob,
  drawBigNumbers,
  drawCoverFooterBand,
  drawFooters,
  drawHeaderBand,
  ensureSpace,
  fitLogo,
  FONT,
  fmtDate,
  fmtMoney,
  fmtNum,
  imageFormat,
  mm,
  NEUTRAL,
  PAGE,
  sanitize,
  slugify,
} from "@/lib/exports/theme";

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

export function proposalPdfFilename(
  accountName: string | null | undefined,
  title: string | null | undefined,
  version: number | null | undefined,
): string {
  return `GridMind_Proposal_${slugify(accountName ?? "Account")}_${slugify(title ?? "Proposal")}_v${version ?? 1}.pdf`;
}

export async function buildProposalPdf(
  data: ProposalPdfData,
): Promise<{ blob: Blob; filename: string }> {
  const { proposal, lineItems, opportunity, company, branding, yieldResult } = data;
  const currency = proposal.currency_code || "USD";

  const theme = await createExportTheme(
    {
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      footerText: branding.footerText,
      logoSignedUrl: branding.logoSignedUrl,
    },
    { name: company.name, legal_name: company.legal_name },
  );

  const doc = createDoc();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = contentWidth(doc);
  const clientName = sanitize(opportunity?.account_name || opportunity?.name || "—");
  const proposalTitle = sanitize(proposal.title || "Proposal");

  // --- Cover page --------------------------------------------------------
  // Vertical rhythm is tightened deliberately: logo → title → proposal
  // number/revision → "Prepared for" block → big-number row (~60% down the
  // page) → cover footer band. No large dead zone in the middle.
  if (theme.logoDataUrl) {
    try {
      const { w, h } = fitLogo(doc, theme.logoDataUrl, mm(20), mm(70));
      doc.addImage(
        theme.logoDataUrl,
        imageFormat(theme.logoDataUrl),
        (pageW - w) / 2,
        mm(20),
        w,
        h,
        undefined,
        "FAST",
      );
    } catch {
      // a broken logo must never break a document
    }
  }

  let y = mm(48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  const titleLines = doc.splitTextToSize(proposalTitle, width);
  doc.text(titleLines, pageW / 2, y, { align: "center" });
  y += titleLines.length * mm(9) + mm(4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
  doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
  doc.text(
    `Proposal #${sanitize(proposal.proposal_number ?? proposal.id ?? "—")} · Revision ${proposal.version ?? 1}`,
    pageW / 2,
    y,
    {
      align: "center",
    },
  );
  y += mm(12);

  const left = PAGE.margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
  doc.text("Prepared for", left, y);
  y += mm(7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
  doc.setTextColor(NEUTRAL.body[0], NEUTRAL.body[1], NEUTRAL.body[2]);
  const preparedForLines: string[] = [clientName];
  if (company.contact_email) preparedForLines.push(sanitize(company.contact_email));
  if (company.phone) preparedForLines.push(sanitize(company.phone));
  preparedForLines.push(`Date: ${fmtDate(new Date().toISOString())}`);
  if (proposal.valid_until) preparedForLines.push(`Valid until: ${fmtDate(proposal.valid_until)}`);
  for (const line of preparedForLines) {
    doc.text(line, left, y);
    y += mm(6);
  }

  // Big-number block row anchored around 60% down the page so the cover
  // reads as one continuous composition rather than logo/title up top and
  // an empty gap before the footer band.
  const array = (proposal.array_config as any) ?? {};
  const dcMw = Number(array.dc_capacity_kw ?? 0) / 1000;
  const bigNumbersY = Math.max(y + mm(10), pageH * 0.6);
  y = drawBigNumbers(
    doc,
    theme,
    [
      { label: "Capacity", value: dcMw > 0 ? `${fmtNum(dcMw, 2)} MW` : "—" },
      {
        label: "P50 annual yield",
        value: yieldResult?.p50_kwh != null ? `${fmtNum(yieldResult.p50_kwh, 0)} kWh` : "—",
      },
      { label: "Total price", value: fmtMoney(proposal.total, currency) },
    ],
    bigNumbersY,
    { perRow: 3 },
  );

  // The page footer already prints the legal name (left slot), so the cover
  // footer band carries a document label instead of repeating it.
  drawCoverFooterBand(doc, theme, "EPC Proposal");

  // --- Content pages -------------------------------------------------------
  doc.addPage();
  const revisionSubtitle = `Revision ${proposal.version ?? 1}`;
  const pageHeader = { title: proposalTitle, subtitle: revisionSubtitle };
  y = drawHeaderBand(doc, theme, proposalTitle, revisionSubtitle);

  // Executive summary
  y = docH2(doc, theme, "Executive summary", y);
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
  y = docTable(doc, theme, {
    startY: y,
    pageHeader,
    theme: "plain",
    body: summaryRows,
    columnStyles: { 0: { fontStyle: "bold", cellWidth: mm(46) } },
  });
  y += mm(8);

  // Scope & pricing
  y = ensureSpace(doc, theme, y, mm(30), proposalTitle);
  y = docH2(doc, theme, "Scope & pricing", y);
  y = docTable(doc, theme, {
    startY: y,
    pageHeader,
    head: [["Category", "Description", "Qty", "Unit", "Unit price", "Total"]],
    body: (lineItems ?? []).map((li: any) => [
      sanitize(li.category ?? ""),
      sanitize(li.description ?? ""),
      fmtNum(li.qty, 2),
      sanitize(li.unit ?? ""),
      fmtMoney(li.unit_price, currency),
      fmtMoney(li.line_total, currency),
    ]),
    columnStyles: {
      2: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });
  y += mm(4);

  const contingencyAmt =
    (Number(proposal.subtotal ?? 0) * Number(proposal.contingency_pct ?? 0)) / 100;
  const totalsRows: Array<[string, string]> = [
    ["Subtotal", fmtMoney(proposal.subtotal, currency)],
    [`Contingency (${fmtNum(proposal.contingency_pct, 2)}%)`, fmtMoney(contingencyAmt, currency)],
    ["Total", fmtMoney(proposal.total, currency)],
  ];
  y = ensureSpace(doc, theme, y, mm(24), proposalTitle);
  y = docTable(doc, theme, {
    startY: y,
    pageHeader,
    theme: "plain",
    margin: { left: pageW - PAGE.margin - mm(85), right: PAGE.margin },
    body: totalsRows,
    totalRows: [totalsRows.length - 1],
    columnStyles: {
      0: { fontStyle: "bold", halign: "right", cellWidth: mm(50) },
      1: { halign: "right", cellWidth: mm(35) },
    },
  });
  y += mm(10);

  // Yield summary
  y = ensureSpace(doc, theme, y, mm(60), proposalTitle);
  y = docH2(doc, theme, "Yield summary", y);
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
  y = docTable(doc, theme, {
    startY: y,
    pageHeader,
    theme: "plain",
    body: yieldRows,
    columnStyles: { 0: { fontStyle: "bold", cellWidth: mm(56) } },
  });
  y += mm(4);

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
    y = ensureSpace(doc, theme, y, mm(18), proposalTitle);
    y = docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [months],
      body: [monthly.map((v) => fmtNum(v, 0))],
      styles: { halign: "right" },
      headStyles: { halign: "right" },
    });
    y += mm(8);
  }

  // Terms
  y = ensureSpace(doc, theme, y, mm(40), proposalTitle);
  y = docH2(doc, theme, "Terms", y);
  const termLines: string[] = [
    `Currency: ${sanitize(currency)}`,
    proposal.valid_until
      ? `Validity: quote valid until ${fmtDate(proposal.valid_until)}.`
      : "Validity: see cover.",
  ];
  for (const line of termLines) {
    y = docBody(doc, line, y, width);
  }
  if (proposal.notes) {
    y += mm(2);
    y = ensureSpace(doc, theme, y, mm(20), proposalTitle);
    y = docBody(doc, proposal.notes, y, width);
  }

  drawFooters(doc, theme);

  const blob = doc.output("blob");
  const filename = proposalPdfFilename(opportunity?.account_name, proposal.title, proposal.version);
  return { blob, filename };
}

export { downloadBlob };
