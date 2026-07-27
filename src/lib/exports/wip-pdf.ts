// P-197 — Lender-ready Work-in-Progress schedule PDF (shared export theme).
import {
  createDoc,
  createExportTheme,
  contentWidth,
  docCaption,
  docH1,
  docTable,
  drawBigNumbers,
  drawFooters,
  drawHeaderBand,
  fmtDate,
  fmtMoney,
  fmtPct,
  numericCol,
  sanitize,
  slugify,
  mm,
  PAGE,
  tableEndY,
} from "@/lib/exports/theme";
import {
  BILLING_FLAG_LABEL,
  WIP_FORMULAS,
  type WipContractRow,
  type WipRollup,
} from "@/lib/wip.rules";

export interface WipPdfInput {
  project: { name: string; code: string | null } | null;
  asOfDate: string;
  preparedBy: string;
  currency: string;
  rows: WipContractRow[];
  rollup: WipRollup;
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    footerText: string | null;
    logoSignedUrl: string | null;
  } | null;
  company: { name: string; legalName: string | null };
}

const TITLE = "Work-in-Progress Schedule — percentage-of-completion (certified)";

export function wipReportFilename(input: {
  project: { name: string; code: string | null } | null;
  asOfDate: string;
}): string {
  const base = input.project?.code || input.project?.name || "project";
  return `wip-schedule-${slugify(base)}-${input.asOfDate}.pdf`;
}

export async function buildWipReportPdfBytes(input: WipPdfInput): Promise<Uint8Array> {
  const theme = await createExportTheme(input.branding, input.company);
  const doc = createDoc();
  const money = (v: number) => fmtMoney(v, input.currency);

  const subtitle = `As of ${fmtDate(input.asOfDate)}`;
  let y = drawHeaderBand(doc, theme, TITLE, subtitle);

  y = docH1(doc, input.project?.name ?? "All contracts", y);
  y = docCaption(
    doc,
    `${input.project?.code ? `${input.project.code} · ` : ""}As-of date ${fmtDate(
      input.asOfDate,
    )} · Prepared by ${sanitize(input.preparedBy)}`,
    y,
  );

  y =
    drawBigNumbers(
      doc,
      theme,
      [
        { label: "Earned revenue", value: money(input.rollup.earned) },
        { label: "Billed", value: money(input.rollup.billed) },
        { label: "Collected", value: money(input.rollup.collected) },
        {
          label: "Net WIP",
          value: money(input.rollup.wip),
          hint: input.rollup.wip >= 0 ? "Under-billed (asset)" : "Over-billed (liability)",
        },
      ],
      y + mm(2),
    ) + mm(2);

  y =
    drawBigNumbers(
      doc,
      theme,
      [
        { label: "Under-billed", value: money(input.rollup.under_billed) },
        { label: "Over-billed", value: money(input.rollup.over_billed) },
        { label: "Retention withheld", value: money(input.rollup.retention_withheld) },
        { label: "Contract value", value: money(input.rollup.contract_value) },
      ],
      y,
    ) + mm(4);

  const body = input.rows.map((r) => [
    sanitize(r.contract_number),
    sanitize(r.counterparty),
    money(r.value),
    fmtPct(r.percent_complete),
    money(r.earned),
    money(r.billed),
    money(r.collected),
    money(r.wip),
    BILLING_FLAG_LABEL[r.flag],
    money(r.retention_withheld),
  ]);

  const totals = [
    "Total",
    `${input.rollup.contracts} contract${input.rollup.contracts === 1 ? "" : "s"}`,
    money(input.rollup.contract_value),
    fmtPct(input.rollup.contract_value > 0 ? input.rollup.earned / input.rollup.contract_value : 0),
    money(input.rollup.earned),
    money(input.rollup.billed),
    money(input.rollup.collected),
    money(input.rollup.wip),
    input.rollup.wip >= 0 ? "Under-billed" : "Over-billed",
    money(input.rollup.retention_withheld),
  ];

  const rows = body.length > 0 ? [...body, totals] : [totals];

  docTable(doc, theme, {
    startY: y,
    pageHeader: { title: TITLE, subtitle },
    head: [
      [
        "Contract",
        "Counterparty",
        "Value",
        "% complete",
        "Earned",
        "Billed",
        "Collected",
        "WIP",
        "Position",
        "Retention",
      ],
    ],
    body: rows,
    totalRows: [rows.length - 1],
    styles: { fontSize: 7.5 },
    columnStyles: {
      2: numericCol,
      3: numericCol,
      4: numericCol,
      5: numericCol,
      6: numericCol,
      7: numericCol,
      9: numericCol,
    },
  });

  let fy = tableEndY(doc, y) + mm(8);
  const pageH = doc.internal.pageSize.getHeight();
  if (fy > pageH - mm(45)) {
    doc.addPage();
    fy = drawHeaderBand(doc, theme, TITLE, subtitle);
  }

  fy = docCaption(doc, "Basis of preparation", fy);
  for (const line of [WIP_FORMULAS.earned, WIP_FORMULAS.billed, WIP_FORMULAS.wip]) {
    const lines = doc.splitTextToSize(sanitize(line), contentWidth(doc));
    doc.setFontSize(8);
    doc.text(lines, PAGE.margin, fy);
    fy += lines.length * 10 + 4;
  }

  drawFooters(doc, theme);
  return new Uint8Array(doc.output("arraybuffer"));
}
