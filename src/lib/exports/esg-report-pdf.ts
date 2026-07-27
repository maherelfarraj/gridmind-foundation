// P-219 — Branded ESG report PDF (client-side jsPDF, shared export theme).
import { format, parseISO } from "date-fns";

import type { EsgReportPackage } from "@/lib/esg/report.server";
import {
  createDoc,
  createExportTheme,
  docBody,
  docCaption,
  docH1,
  docH2,
  docTable,
  drawBigNumbers,
  drawFooters,
  drawHeaderBand,
  ensureSpace,
  fmtNum,
  numericCol,
  PAGE,
  sanitize,
} from "@/lib/exports/theme";

const t = (kg: number | null): string => (kg == null ? "n/a" : `${fmtNum(kg / 1000, 2)} t`);

function periodLabel(from: string, to: string): string {
  const f = format(parseISO(`${from}T00:00:00`), "d MMM yyyy");
  const s = format(parseISO(`${to}T00:00:00`), "d MMM yyyy");
  return `${f} – ${s}`;
}

export function esgPdfFilename(pkg: EsgReportPackage): string {
  const base = pkg.report.report_number ?? "ESG-report";
  return `${base}_${pkg.report.period_from}_${pkg.report.period_to}.pdf`;
}

export async function buildEsgReportPdfBytes(pkg: EsgReportPackage): Promise<Uint8Array> {
  const theme = await createExportTheme(
    {
      primaryColor: pkg.branding.primaryColor,
      accentColor: pkg.branding.accentColor,
      footerText: pkg.branding.footerText,
      logoSignedUrl: pkg.branding.logoSignedUrl,
    },
    pkg.company,
  );

  const doc = createDoc();
  const title = `ESG Report ${sanitize(pkg.report.report_number ?? "")}`.trim();
  const subtitle = `${sanitize(pkg.project.name)} · ${periodLabel(pkg.report.period_from, pkg.report.period_to)}`;
  const pageHeader = { title, subtitle };

  // ---- Cover ---------------------------------------------------------------
  let y = drawHeaderBand(doc, theme, title, subtitle);
  y = docH1(doc, sanitize(pkg.company.legalName ?? pkg.company.name), y + 6);
  y = docBody(
    doc,
    `Project: ${sanitize(pkg.project.code ? `${pkg.project.code} — ${pkg.project.name}` : pkg.project.name)}`,
    y + 4,
  );
  y = docBody(
    doc,
    `Reporting period: ${periodLabel(pkg.report.period_from, pkg.report.period_to)}`,
    y,
  );
  y = docBody(doc, `Report number: ${sanitize(pkg.report.report_number ?? "—")}`, y);
  y += 10;

  // ---- Executive summary tiles --------------------------------------------
  y = docH2(doc, theme, "Executive summary", y);
  y = drawBigNumbers(
    doc,
    theme,
    [
      { label: "Scope 1", value: t(pkg.summary.scope_1_kg), hint: "t CO2e" },
      { label: "Scope 2", value: t(pkg.summary.scope_2_kg), hint: "t CO2e" },
      { label: "Scope 3", value: t(pkg.summary.scope_3_kg), hint: "t CO2e" },
      { label: "Avoided", value: t(pkg.summary.avoided_kg), hint: "t CO2e" },
      { label: "Net", value: t(pkg.summary.net_kg), hint: "t CO2e" },
    ],
    y,
    { perRow: 5 },
  );
  y += 8;

  // ---- Scope tables --------------------------------------------------------
  for (const scope of pkg.scopes) {
    y = ensureSpace(doc, theme, y, 140, title);
    y = docH2(doc, theme, scope.title, y);
    const body: string[][] = scope.rows.length
      ? scope.rows.map((r) => [
          sanitize(r.category),
          r.quantity,
          sanitize(r.unit),
          sanitize(r.factor_code),
          sanitize(r.factor_source),
          fmtNum(r.co2e_kg, 2),
        ])
      : [["—", "", "", "", "", "0"]];
    if (scope.rows.length) {
      body.push(["Subtotal", "", "", "", "", fmtNum(scope.subtotal_kg, 2)]);
    }
    y =
      docTable(doc, theme, {
        startY: y,
        pageHeader,
        head: [["Category", "Quantity", "Unit", "Factor code", "Factor source", "kg CO2e"]],
        body,
        totalRows: scope.rows.length ? [body.length - 1] : [],
        columnStyles: { 1: numericCol, 5: numericCol },
      }) + 14;
  }

  // ---- Avoided emissions ---------------------------------------------------
  y = ensureSpace(doc, theme, y, 130, title);
  y = docH2(doc, theme, "Avoided emissions", y);
  const avoidedBody: string[][] = pkg.avoided.note
    ? [["Status", pkg.avoided.note]]
    : [
        ["Metered generation (MWh)", fmtNum(pkg.avoided.metered_mwh ?? 0, 2)],
        ["Grid emission factor (kg CO2e/kWh)", fmtNum(pkg.avoided.grid_factor_kg_per_kwh, 4)],
        [
          "Factor citation",
          `${sanitize(pkg.avoided.grid_factor_code)} — ${sanitize(pkg.avoided.grid_factor_source)}`,
        ],
        ["Avoided emissions (t CO2e)", t(pkg.avoided.avoided_kg)],
      ];
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      body: avoidedBody,
      columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
    }) + 14;

  // ---- Lender indicators ---------------------------------------------------
  y = ensureSpace(doc, theme, y, 160, title);
  y = docH2(doc, theme, "Lender indicators", y);
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [["Indicator", "Value", "Formula"]],
      body: pkg.lender_indicators.map((r) => [
        sanitize(r.indicator),
        sanitize(r.value),
        sanitize(r.formula),
      ]),
      columnStyles: { 1: numericCol },
    }) + 14;

  // ---- Methodology ---------------------------------------------------------
  y = ensureSpace(doc, theme, y, 120, title);
  y = docH2(doc, theme, "Methodology", y);
  y = docBody(
    doc,
    "Emissions are computed per activity row as quantity x emission factor, with the factor resolved by category and validity window. Scope classification follows the GHG Protocol category mapping recorded with each factor.",
    y + 2,
  );
  y = docCaption(doc, pkg.methodology_note, y + 8);

  drawFooters(doc, theme);
  return new Uint8Array(doc.output("arraybuffer"));
}

export { PAGE };
