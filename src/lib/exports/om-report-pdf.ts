// P-110 — Branded monthly O&M report PDF (client-side jsPDF).
import { format, parseISO } from "date-fns";

import { omReportFilename, type OmReportSnapshot } from "@/lib/om-reports.rules";
import type { OmReportBrandingDTO, OmReportGeneratedDTO } from "@/lib/om-reports.functions";
import {
  createDoc,
  createExportTheme,
  drawHeaderBand,
  drawFooters,
  docH2,
  docCaption,
  docTable,
  ensureSpace,
  drawBigNumbers,
  fmtPct,
  fmtNum,
  sanitize,
  PAGE,
  type ExportTheme,
} from "@/lib/exports/theme";

function ensureRoom(
  doc: ReturnType<typeof createDoc>,
  theme: ExportTheme,
  y: number,
  need: number,
  title: string,
): number {
  return ensureSpace(doc, theme, y, need, title);
}

export async function buildOmReportPdfBytes(input: OmReportGeneratedDTO): Promise<Uint8Array> {
  const branding: OmReportBrandingDTO = input.branding;
  const snap: OmReportSnapshot = input.report.data;

  const theme = await createExportTheme(
    {
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      footerText: branding.footerText,
      logoSignedUrl: branding.logoSignedUrl,
    },
    input.company,
  );

  const doc = createDoc();
  const periodLabel = format(parseISO(`${input.report.period_start}T00:00:00`), "MMMM yyyy");
  const pageTitle = "Monthly O&M Report";
  const pageSubtitle = `${sanitize(input.project.name)} · ${periodLabel}`;
  const pageHeader = { title: pageTitle, subtitle: pageSubtitle };

  let cursorY = drawHeaderBand(doc, theme, pageTitle, pageSubtitle);

  // ---- Two dominant big-number blocks: availability + PR --------------------
  const dominantItems = [
    {
      label: "Availability",
      value: fmtPct(snap.availability.value),
    },
    {
      label: "Performance ratio",
      value:
        snap.performanceRatio.reason === "insufficient_data"
          ? "Insufficient data"
          : fmtPct(snap.performanceRatio.value),
    },
  ];
  cursorY = drawBigNumbers(doc, theme, dominantItems, cursorY, {
    perRow: 2,
    height: PAGE.margin + 20,
  });
  cursorY += 6;

  // ---- Secondary KPI row -----------------------------------------------------
  const kpis = [
    { label: "Alarms (period)", value: String(snap.alarms.total) },
    { label: "Spend", value: snap.spend.totalFormatted },
  ];
  cursorY = drawBigNumbers(doc, theme, kpis, cursorY, { perRow: 2 });
  cursorY += 6;

  // ---- Availability breakdown --------------------------------------------
  cursorY = ensureRoom(doc, theme, cursorY, 120, pageTitle);
  cursorY = docH2(doc, theme, "Availability breakdown", cursorY);
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      body: [
        ["Period hours", fmtNum(snap.periodHours, 1)],
        ["Alarm downtime (h)", fmtNum(snap.availability.alarmDowntimeHours, 2)],
        ["Corrective WO downtime (h)", fmtNum(snap.availability.correctiveWoDowntimeHours, 2)],
        ["Total downtime (h)", fmtNum(snap.availability.downtimeHours, 2)],
        ["Availability %", fmtPct(snap.availability.value)],
      ],
      columnStyles: {
        0: { fontStyle: "bold", textColor: [60, 60, 60] },
        1: { halign: "right" },
      },
    }) + 18;

  // ---- Performance ratio --------------------------------------------------
  cursorY = ensureRoom(doc, theme, cursorY, 120, pageTitle);
  cursorY = docH2(doc, theme, "Performance ratio", cursorY);
  const prBody: string[][] =
    snap.performanceRatio.reason === "insufficient_data"
      ? [["Status", "Insufficient telemetry — connect meters and irradiance sensors to populate."]]
      : [
          ["Metered energy (kWh)", fmtNum(snap.performanceRatio.actualKwh, 0)],
          [
            "Plane-of-array irradiance (kWh/m²)",
            fmtNum(snap.performanceRatio.irradianceKwhPerM2, 2),
          ],
          ["Installed capacity (kWp)", fmtNum(snap.performanceRatio.capacityKwp, 1)],
          ["Performance ratio", fmtPct(snap.performanceRatio.value)],
        ];
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      body: prBody,
      columnStyles: {
        0: { fontStyle: "bold", textColor: [60, 60, 60] },
        1: { halign: "right" },
      },
    }) + 18;

  // ---- Alarms summary ------------------------------------------------------
  cursorY = ensureRoom(doc, theme, cursorY, 160, pageTitle);
  cursorY = docH2(doc, theme, "Alarms summary", cursorY);
  const severityRows: string[][] = Object.entries(snap.alarms.bySeverity).map(([sev, n]) => [
    sanitize(sev),
    String(n),
  ]);
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      head: [["Severity", "Count"]],
      body: severityRows.length > 0 ? severityRows : [["—", "No alarms in period"]],
      columnStyles: { 1: { halign: "right", cellWidth: 100 } },
    }) + 10;

  const topRules = snap.alarms.topRecurring;
  if (topRules.length > 0) {
    cursorY = ensureRoom(doc, theme, cursorY, 100, pageTitle);
    cursorY =
      docTable(doc, theme, {
        startY: cursorY,
        pageHeader,
        head: [["Top recurring rules", "Firings"]],
        body: topRules.map((r) => [sanitize(r.ruleName), String(r.count)]),
        columnStyles: { 1: { halign: "right", cellWidth: 100 } },
      }) + 10;
  }

  cursorY = docCaption(
    doc,
    `Mean acknowledge time: ${
      snap.alarms.meanAcknowledgeMinutes == null
        ? "—"
        : `${fmtNum(snap.alarms.meanAcknowledgeMinutes, 1)} min`
    }`,
    cursorY + 8,
  );
  cursorY += 12;

  // ---- Work orders --------------------------------------------------------
  cursorY = ensureRoom(doc, theme, cursorY, 140, pageTitle);
  cursorY = docH2(doc, theme, "Work orders", cursorY);
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      body: [
        ["Opened", String(snap.workOrders.opened)],
        ["Closed", String(snap.workOrders.closed)],
        ["Preventive", String(snap.workOrders.preventive)],
        ["Corrective", String(snap.workOrders.corrective)],
        ["PM : CM ratio", fmtPct(snap.workOrders.pmCmRatio)],
        [
          "MTTR (h)",
          snap.workOrders.mttrHours == null ? "—" : fmtNum(snap.workOrders.mttrHours, 2),
        ],
      ],
      columnStyles: {
        0: { fontStyle: "bold", textColor: [60, 60, 60] },
        1: { halign: "right" },
      },
    }) + 18;

  // ---- Spend --------------------------------------------------------------
  cursorY = ensureRoom(doc, theme, cursorY, 140, pageTitle);
  cursorY = docH2(doc, theme, "Spend by work-order type", cursorY);
  const spendRows: string[][] = Object.entries(snap.spend.byType).map(([type, amount]) => [
    sanitize(type),
    snap.spend.byTypeFormatted[type] ?? String(amount),
  ]);
  const spendBody = spendRows.length > 0 ? [...spendRows] : [["—", "No spend recorded"]];
  const totalRowIdx = spendRows.length > 0 ? spendBody.length : -1;
  if (spendRows.length > 0) spendBody.push(["Total", snap.spend.totalFormatted]);
  cursorY =
    docTable(doc, theme, {
      startY: cursorY,
      pageHeader,
      head: [["Type", "Amount"]],
      body: spendBody,
      columnStyles: { 1: { halign: "right", cellWidth: 140 } },
      totalRows: totalRowIdx >= 0 ? [totalRowIdx] : [],
    }) + 18;

  drawFooters(doc, theme);

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

export { omReportFilename };
