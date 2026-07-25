// P-095 — Performance Ratio test report PDF (client-side jsPDF, branded).
//
// Ampersands ("O&M team") render literally via the shared theme's sanitize().
import {
  createDoc,
  createExportThemeSync,
  drawHeaderBand,
  drawFooters,
  docH2,
  docTable,
  docBody,
  docCaption,
  ensureSpace,
  drawBigNumbers,
  fmtNum,
  fmtDate,
  sanitize,
  numericCol,
} from "@/lib/exports/theme";

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

export function buildPrTestReportPdfBytes(input: PrReportInput): Uint8Array {
  const theme = createExportThemeSync(
    {
      primaryColor: input.branding.primaryColor,
      accentColor: input.branding.accentColor,
      logoDataUrl: input.branding.logoDataUrl,
    },
    { name: input.company.name, legal_name: input.company.legalName },
  );

  const doc = createDoc();
  const pageTitle = "Performance Ratio Test Report";
  const subtitle = `${sanitize(input.project.name)} · ${fmtDate(input.periodStart)} – ${fmtDate(input.periodEnd)}`;
  const pageHeader = { title: pageTitle, subtitle };
  let y = drawHeaderBand(doc, theme, pageTitle, subtitle);

  // KPI band: measured / contract / variance
  const variancePrefix = input.variancePct >= 0 ? "+" : "";
  y = drawBigNumbers(
    doc,
    theme,
    [
      { label: "Measured PR", value: `${fmtNum(input.measuredPrPct, 2)}%` },
      { label: "Contract PR", value: `${fmtNum(input.contractPrPct, 2)}%` },
      { label: "Variance", value: `${variancePrefix}${fmtNum(input.variancePct, 2)}%` },
    ],
    y,
    { perRow: 3 },
  );
  y += 8;

  // Inputs & Method table
  y = ensureSpace(doc, theme, y, 160, pageTitle);
  y = docH2(doc, theme, "Inputs & Method", y);
  y =
    docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [["Parameter", "Value", "Unit"]],
      body: [
        ["Period start", fmtDate(input.periodStart), ""],
        ["Period end", fmtDate(input.periodEnd), ""],
        ["Metered energy", fmtNum(input.meteredEnergyMwh, 2), "MWh"],
        ["Plane-of-array insolation", fmtNum(input.poaKwhPerM2, 2), "kWh/m²"],
        ["Nominal DC capacity", fmtNum(input.capacityMwp, 3), "MWp"],
        ["Contract PR (per O&M contract)", fmtNum(input.contractPrPct, 2), "%"],
        ["Measured PR", fmtNum(input.measuredPrPct, 2), "%"],
      ],
      columnStyles: {
        1: numericCol,
        2: { cellWidth: 70 },
      },
    }) + 18;

  y = ensureSpace(doc, theme, y, 60, pageTitle);
  y = docH2(doc, theme, "Formula", y);
  y = docBody(
    doc,
    "PR% = metered energy (MWh) / ( POA insolation (kWh/m²) × nominal DC capacity (MWp) ) × 100",
    y,
  );
  y += 8;

  if (input.notes) {
    y = ensureSpace(doc, theme, y, 80, pageTitle);
    y = docH2(doc, theme, "Notes", y);
    y = docBody(doc, input.notes, y) + 4;
  }

  docCaption(
    doc,
    `Generated ${fmtDate(input.generatedAt)} · ${sanitize(input.company.legalName || input.company.name)}`,
    y,
  );

  drawFooters(doc, theme);

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
