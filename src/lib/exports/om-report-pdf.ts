// P-110 — Branded monthly O&M report PDF (client-side jsPDF).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

import { omReportFilename, sanitizeText, type OmReportSnapshot } from "@/lib/om-reports.rules";
import type { OmReportBrandingDTO, OmReportGeneratedDTO } from "@/lib/om-reports.functions";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

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

async function fetchImageDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === "function" ? btoa(bin) : "";
    if (!b64) return null;
    const ct = res.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

function imageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return iso;
  }
}

function sectionTitle(
  doc: jsPDF,
  label: string,
  x: number,
  y: number,
  accent: [number, number, number],
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(sanitizeText(label).toUpperCase(), x, y);
  doc.setTextColor(30, 30, 30);
}

function tableEnd(doc: jsPDF, fallback: number): number {
  return (doc as any).lastAutoTable?.finalY ?? fallback;
}

function ensureRoom(
  doc: jsPDF,
  cursorY: number,
  need: number,
  margin: number,
  pageH: number,
): number {
  if (cursorY + need > pageH - 60) {
    doc.addPage();
    return margin + 20;
  }
  return cursorY;
}

export async function buildOmReportPdfBytes(input: OmReportGeneratedDTO): Promise<Uint8Array> {
  const branding: OmReportBrandingDTO = input.branding;
  const snap: OmReportSnapshot = input.report.data;
  const primary = hexToRgb(branding.primaryColor, DEFAULT_PRIMARY);
  const accent = hexToRgb(branding.accentColor, DEFAULT_ACCENT);
  const logo = await fetchImageDataUrl(branding.logoSignedUrl);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  const periodLabel = format(parseISO(`${input.report.period_start}T00:00:00`), "MMMM yyyy");

  // ---- Header band ---------------------------------------------------------
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageW, 96, "F");
  if (logo) {
    try {
      doc.addImage(logo, imageFormat(logo), margin, 22, 52, 52);
    } catch {
      /* ignore malformed logo */
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(
    sanitizeText(input.company.legalName || input.company.name),
    margin + (logo ? 66 : 0),
    44,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    sanitizeText(`Monthly O&M Report — ${input.project.name} · ${periodLabel}`),
    margin + (logo ? 66 : 0),
    64,
  );
  doc.setFontSize(9);
  doc.text(
    sanitizeText(`${fmtDate(input.report.period_start)} – ${fmtDate(input.report.period_end)}`),
    margin + (logo ? 66 : 0),
    80,
  );

  const rightMeta: string[] = [];
  if (input.project.code) rightMeta.push(`Code ${input.project.code}`);
  if (snap.performanceRatio.capacityKwp != null) {
    rightMeta.push(`${fmtNum(snap.performanceRatio.capacityKwp / 1000, 1)} MWp`);
  }
  rightMeta.forEach((line, i) => {
    doc.text(sanitizeText(line), pageW - margin, 40 + i * 14, {
      align: "right",
    });
  });

  doc.setTextColor(30, 30, 30);
  let cursorY = 120;

  // ---- KPI row -------------------------------------------------------------
  const kpis: Array<[string, string]> = [
    ["Availability", fmtPct(snap.availability.value)],
    [
      "Performance ratio",
      snap.performanceRatio.reason === "insufficient_data"
        ? "Insufficient data"
        : fmtPct(snap.performanceRatio.value),
    ],
    ["Alarms (period)", String(snap.alarms.total)],
    ["Spend", snap.spend.totalFormatted],
  ];
  const boxW = (pageW - margin * 2 - 12) / 4;
  kpis.forEach(([label, value], i) => {
    const x = margin + i * (boxW + 4);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(246, 247, 249);
    doc.roundedRect(x, cursorY, boxW, 62, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(sanitizeText(label).toUpperCase(), x + 10, cursorY + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(sanitizeText(value), x + 10, cursorY + 44);
  });
  doc.setTextColor(30, 30, 30);
  cursorY += 78;

  // ---- Availability breakdown --------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 120, margin, pageH);
  sectionTitle(doc, "Availability breakdown", margin, cursorY, accent);
  cursorY += 6;
  autoTable(doc, {
    startY: cursorY + 6,
    body: [
      ["Period hours", fmtNum(snap.periodHours, 1)],
      ["Alarm downtime (h)", fmtNum(snap.availability.alarmDowntimeHours, 2)],
      ["Corrective WO downtime (h)", fmtNum(snap.availability.correctiveWoDowntimeHours, 2)],
      ["Total downtime (h)", fmtNum(snap.availability.downtimeHours, 2)],
      ["Availability %", fmtPct(snap.availability.value)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: 60 },
      1: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Performance ratio --------------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 120, margin, pageH);
  sectionTitle(doc, "Performance ratio", margin, cursorY, accent);
  cursorY += 6;
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
  autoTable(doc, {
    startY: cursorY + 6,
    body: prBody,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: 60 },
      1: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Alarms summary ------------------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 160, margin, pageH);
  sectionTitle(doc, "Alarms summary", margin, cursorY, accent);
  cursorY += 6;
  const severityRows: string[][] = Object.entries(snap.alarms.bySeverity).map(([sev, n]) => [
    sanitizeText(sev),
    String(n),
  ]);
  autoTable(doc, {
    startY: cursorY + 6,
    head: [["Severity", "Count"]],
    body: severityRows.length > 0 ? severityRows : [["—", "No alarms in period"]],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: { 1: { halign: "right", cellWidth: 100 } },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 10;

  const topRules = snap.alarms.topRecurring;
  if (topRules.length > 0) {
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Top recurring rules", "Firings"]],
      body: topRules.map((r) => [sanitizeText(r.ruleName), String(r.count)]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: {
        fillColor: [primary[0], primary[1], primary[2]],
        textColor: 255,
        fontStyle: "bold",
      },
      columnStyles: { 1: { halign: "right", cellWidth: 100 } },
      alternateRowStyles: { fillColor: [248, 249, 251] },
    });
    cursorY = tableEnd(doc, cursorY) + 10;
  }

  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(
    sanitizeText(
      `Mean acknowledge time: ${
        snap.alarms.meanAcknowledgeMinutes == null
          ? "—"
          : `${fmtNum(snap.alarms.meanAcknowledgeMinutes, 1)} min`
      }`,
    ),
    margin,
    cursorY + 8,
  );
  doc.setTextColor(30, 30, 30);
  cursorY += 22;

  // ---- Work orders --------------------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 140, margin, pageH);
  sectionTitle(doc, "Work orders", margin, cursorY, accent);
  cursorY += 6;
  autoTable(doc, {
    startY: cursorY + 6,
    body: [
      ["Opened", String(snap.workOrders.opened)],
      ["Closed", String(snap.workOrders.closed)],
      ["Preventive", String(snap.workOrders.preventive)],
      ["Corrective", String(snap.workOrders.corrective)],
      ["PM : CM ratio", fmtPct(snap.workOrders.pmCmRatio)],
      ["MTTR (h)", snap.workOrders.mttrHours == null ? "—" : fmtNum(snap.workOrders.mttrHours, 2)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: 60 },
      1: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Spend --------------------------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 140, margin, pageH);
  sectionTitle(doc, "Spend by work-order type", margin, cursorY, accent);
  cursorY += 6;
  const spendRows: string[][] = Object.entries(snap.spend.byType).map(([type, amount]) => [
    sanitizeText(type),
    snap.spend.byTypeFormatted[type] ?? String(amount),
  ]);
  autoTable(doc, {
    startY: cursorY + 6,
    head: [["Type", "Amount"]],
    body:
      spendRows.length > 0
        ? [...spendRows, ["Total", snap.spend.totalFormatted]]
        : [["—", "No spend recorded"]],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: { 1: { halign: "right", cellWidth: 140 } },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Footer -------------------------------------------------------------
  const footerText = sanitizeText(
    branding.footerText ||
      `Generated by GridMind EPC · ${input.company.legalName || input.company.name}`,
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
    doc.text(sanitizeText(`${input.project.name} · ${periodLabel}`), pageW / 2, pageH - 24, {
      align: "center",
    });
  }

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

export { omReportFilename };
