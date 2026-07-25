// P-092 — Weekly client report PDF builder (client-side jsPDF).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

import type { WeeklyReportDTO, WeeklyReportPhotoDTO } from "@/lib/field-reports.functions";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";

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

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "PP");
  } catch {
    return String(iso);
  }
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

export async function buildWeeklyReportPdfBytes(input: WeeklyReportDTO): Promise<Uint8Array> {
  const primary = hexToRgb(input.branding.primaryColor, DEFAULT_PRIMARY);
  const accent = hexToRgb(input.branding.accentColor, DEFAULT_ACCENT);
  const logo = await fetchImageDataUrl(input.branding.logoSignedUrl);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  // ---- Header band ------------------------------------------------------
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
  doc.text(sanitize(input.company.legalName || input.company.name), margin + (logo ? 66 : 0), 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    sanitize(`Weekly Construction Report — ${input.project.name} · ${input.isoWeekLabel}`),
    margin + (logo ? 66 : 0),
    64,
  );
  doc.setFontSize(9);
  doc.text(
    sanitize(`${fmtDate(input.weekStart)} – ${fmtDate(input.weekEnd)}`),
    margin + (logo ? 66 : 0),
    80,
  );

  // Project meta right
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rightMeta = [
    input.project.code ? `Code ${input.project.code}` : null,
    input.project.archetype ? sanitize(input.project.archetype) : null,
    input.project.capacityMw != null ? `${fmtNum(input.project.capacityMw, 1)} MW` : null,
  ].filter(Boolean) as string[];
  rightMeta.forEach((line, i) => {
    doc.text(line, pageW - margin, 40 + i * 14, { align: "right" });
  });

  doc.setTextColor(30, 30, 30);
  let cursorY = 120;

  // ---- KPI row ----------------------------------------------------------
  const kpis: Array<[string, string]> = [
    ["SPI", fmtNum(input.kpis.spi)],
    ["CPI", fmtNum(input.kpis.cpi)],
    ["TRIR (12m)", fmtNum(input.kpis.trir12m, 2)],
    ["Rework %", fmtPct(input.kpis.reworkPct)],
  ];
  const boxW = (pageW - margin * 2 - 12) / 4;
  kpis.forEach(([label, value], i) => {
    const x = margin + i * (boxW + 4);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(246, 247, 249);
    doc.roundedRect(x, cursorY, boxW, 60, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), x + 10, cursorY + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(value, x + 10, cursorY + 44);
  });
  doc.setTextColor(30, 30, 30);
  cursorY += 76;

  // ---- Daily log table --------------------------------------------------
  sectionTitle(doc, "Daily log", margin, cursorY, accent);
  cursorY += 6;
  autoTable(doc, {
    startY: cursorY + 6,
    head: [["Date", "Shift", "Manpower", "Hours", "Weather", "Work summary"]],
    body:
      input.daily.length > 0
        ? input.daily.map((r) => [
            r.reportDate,
            sanitize(r.shift),
            String(r.totalManpower),
            fmtNum(r.totalHours, 1),
            sanitize(r.weatherSummary ?? ""),
            sanitize(r.workSummary ?? ""),
          ])
        : [["—", "—", "—", "—", "—", "No DPRs submitted this week"]],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5, valign: "top" },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 46 },
      2: { cellWidth: 60, halign: "right" },
      3: { cellWidth: 52, halign: "right" },
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Discipline / area ------------------------------------------------
  cursorY = ensureRoom(doc, cursorY, 140, margin, pageH);
  sectionTitle(doc, "Installed quantities by discipline / area", margin, cursorY, accent);
  cursorY += 6;
  autoTable(doc, {
    startY: cursorY + 6,
    head: [["Discipline", "Area", "UoM", "Installed this week", "Daily rate", "Planned (WBS)"]],
    body:
      input.disciplines.length > 0
        ? input.disciplines.map((d) => [
            sanitize(d.discipline),
            sanitize(d.area),
            sanitize(d.uom ?? "—"),
            fmtNum(d.installedThisWeek, 2),
            fmtNum(d.dailyRate, 2),
            fmtNum(d.planned, 2),
          ])
        : [["—", "—", "—", "—", "—", "No quantities recorded"]],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5, valign: "top" },
    headStyles: {
      fillColor: [primary[0], primary[1], primary[2]],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  cursorY = tableEnd(doc, cursorY) + 18;

  // ---- Weather delays ---------------------------------------------------
  if (input.weather.length > 0) {
    cursorY = ensureRoom(doc, cursorY, 120, margin, pageH);
    sectionTitle(doc, "Weather delays (lost hours)", margin, cursorY, accent);
    cursorY += 6;
    autoTable(doc, {
      startY: cursorY + 6,
      head: [["Type", "Events", "Lost hours"]],
      body: input.weather.map((w) => [sanitize(w.delayType), String(w.count), fmtNum(w.hours, 1)]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: {
        fillColor: [primary[0], primary[1], primary[2]],
        textColor: 255,
        fontStyle: "bold",
      },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });
    cursorY = tableEnd(doc, cursorY) + 18;
  }

  // ---- HSE + QA two-column summaries -----------------------------------
  cursorY = ensureRoom(doc, cursorY, 180, margin, pageH);
  const halfW = (pageW - margin * 2 - 16) / 2;

  sectionTitle(doc, "HSE summary", margin, cursorY, accent);
  sectionTitle(doc, "QA/QC summary", margin + halfW + 16, cursorY, accent);
  cursorY += 12;

  const hseBody: Array<[string, string]> = [
    ["Recordables this week", String(input.hse.recordablesThisWeek)],
    ["TRIR (trailing 12 months)", fmtNum(input.hse.trir12m, 2)],
    ["Recordables (12m)", String(input.hse.recordables12m)],
    ["Man-hours (12m)", fmtNum(input.hse.hours12m, 0)],
    ...input.hse.incidentsByType.map(
      (r) => [sanitize(r.type), String(r.count)] as [string, string],
    ),
  ];
  const qaBody: Array<[string, string]> = [
    ["Inspections run", String(input.qa.inspectionsRun)],
    ["Pass rate", fmtPct(input.qa.passRate)],
    ["Rework %", fmtPct(input.qa.reworkPct)],
    ["Open punch — A (critical)", String(input.qa.openPunchByCategory.A)],
    ["Open punch — B", String(input.qa.openPunchByCategory.B)],
    ["Open punch — C", String(input.qa.openPunchByCategory.C)],
  ];

  autoTable(doc, {
    startY: cursorY,
    body: hseBody.map(([k, v]) => [k, v]),
    tableWidth: halfW,
    margin: { left: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 1: { halign: "right", cellWidth: 60 } },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  const hseEnd = tableEnd(doc, cursorY);

  autoTable(doc, {
    startY: cursorY,
    body: qaBody.map(([k, v]) => [k, v]),
    tableWidth: halfW,
    margin: { left: margin + halfW + 16 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 1: { halign: "right", cellWidth: 60 } },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  const qaEnd = tableEnd(doc, cursorY);
  cursorY = Math.max(hseEnd, qaEnd) + 18;

  // ---- Lookahead --------------------------------------------------------
  if (input.lookahead.topWeatherImpacts.length > 0 || input.lookahead.plannedAreas.length > 0) {
    cursorY = ensureRoom(doc, cursorY, 140, margin, pageH);
    sectionTitle(doc, "Next-week lookahead", margin, cursorY, accent);
    cursorY += 12;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Top weather impacts (this week)", margin, cursorY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    const wImp =
      input.lookahead.topWeatherImpacts
        .map((w) => `${sanitize(w.delayType)}: ${fmtNum(w.hours, 1)}h`)
        .join(" · ") || "None";
    doc.text(wImp, margin, cursorY + 14, { maxWidth: pageW - margin * 2 });

    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("Planned areas next week", margin, cursorY + 40);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    const planned =
      input.lookahead.plannedAreas
        .map(
          (t) =>
            `${sanitize(t.name)}${
              t.discipline ? ` (${sanitize(t.discipline)})` : ""
            } — ${fmtDate(t.start)}`,
        )
        .join("\n") || "None scheduled";
    const plannedLines = doc.splitTextToSize(planned, pageW - margin * 2);
    doc.text(plannedLines, margin, cursorY + 54);
    cursorY += 60 + plannedLines.length * 12;
  }

  // ---- Photo strip ------------------------------------------------------
  if (input.photos.length > 0) {
    cursorY = ensureRoom(doc, cursorY, 200, margin, pageH);
    sectionTitle(doc, "Site photos", margin, cursorY, accent);
    cursorY += 12;
    await drawPhotoStrip(doc, input.photos, margin, cursorY, pageW - margin * 2);
  }

  // ---- Footer -----------------------------------------------------------
  const footerText = sanitize(
    input.branding.footerText || `Generated by GridMind EPC · ${input.company.name}`,
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
    doc.text(sanitize(`${input.project.name} · ${input.isoWeekLabel}`), pageW / 2, pageH - 24, {
      align: "center",
    });
  }

  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
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
  doc.text(label.toUpperCase(), x, y);
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

async function drawPhotoStrip(
  doc: jsPDF,
  photos: WeeklyReportPhotoDTO[],
  x: number,
  y: number,
  totalW: number,
) {
  const items = photos.slice(0, 6);
  const gap = 8;
  const cols = 3;
  const cellW = (totalW - gap * (cols - 1)) / cols;
  const cellH = 110;
  for (let i = 0; i < items.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = x + col * (cellW + gap);
    const cy = y + row * (cellH + gap + 14);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(246, 247, 249);
    doc.roundedRect(cx, cy, cellW, cellH, 4, 4, "FD");

    const url = items[i].signedUrl;
    const dataUrl = await fetchImageDataUrl(url);
    if (dataUrl) {
      try {
        doc.addImage(dataUrl, imageFormat(dataUrl), cx + 4, cy + 4, cellW - 8, cellH - 8);
      } catch {
        /* ignore malformed image */
      }
    }
    if (items[i].caption) {
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(sanitize(items[i].caption).slice(0, 60), cx, cy + cellH + 12, { maxWidth: cellW });
    }
  }
}

export function weeklyReportFilename(projectName: string, weekLabel: string): string {
  const safeProj = (projectName || "project").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  return `weekly-${safeProj}-${weekLabel}.pdf`;
}
