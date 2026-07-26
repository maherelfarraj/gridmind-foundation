// POL-4 — Shared export theme: ONE layout engine for every GridMind PDF.
//
// All document generators (proposal, weekly report, O&M report, PO, turnover
// index, audit pack cover, certificates) must build their pages through the
// helpers in this module so every artefact reads as one family:
//   page   = A4 portrait, 18 mm margins
//   header = 22 mm band in company_branding.primary_color, logo left
//            (max 12 mm tall, aspect preserved), title right in white
//   rule   = thin accent line under the band
//   footer = legal name (left) · footer_text (center) · Page X of Y (right)
//
// Ampersands always render literally: "O&M" stays "O&M".
import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type UserOptions } from "jspdf-autotable";
import { format, parseISO } from "date-fns";

export const DEFAULT_PRIMARY = "#1e40af";
export const DEFAULT_ACCENT = "#0d9488";

/** Points per millimetre (jsPDF documents are created in "pt"). */
export const PT_PER_MM = 72 / 25.4;
export const mm = (v: number): number => v * PT_PER_MM;

/** Page geometry (A4 portrait, 18 mm margins, 22 mm header band). */
export const PAGE = {
  margin: mm(18),
  headerHeight: mm(22),
  accentRule: 1.6,
  footerBaseline: mm(12),
  logoMaxHeight: mm(12),
} as const;

/** Document typography scale (pt). */
export const FONT = {
  h1: 16,
  h2: 12,
  body: 9.5,
  tableBody: 8.5,
  tableHead: 8.5,
  caption: 8,
  kpiValue: 20,
  kpiLabel: 7.5,
  footer: 8,
} as const;

export type Rgb = [number, number, number];

/** Neutral ramp used for stripes, rules and muted text. */
export const NEUTRAL = {
  ink: [24, 28, 34] as Rgb,
  body: [45, 52, 62] as Rgb,
  muted: [120, 128, 140] as Rgb,
  line: [222, 226, 232] as Rgb,
  stripe: [247, 248, 250] as Rgb,
  white: [255, 255, 255] as Rgb,
} as const;

/**
 * Undo accidental HTML-entity escaping so text like "O&M" / "C&I" renders
 * correctly, and strip the "&;" artefact from earlier broken pipelines.
 */
export function sanitize(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&;/g, "&");
}

export function hexToRgb(hex: string | null | undefined, fallback = DEFAULT_PRIMARY): Rgb {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  const raw = m ? m[1] : fallback.replace("#", "");
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `${h(r)}${h(g)}${h(b)}`;
}

/** Mix a colour toward white — used for section sub-header tints. */
export function tint(color: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(color[0] + (255 - color[0]) * t),
    Math.round(color[1] + (255 - color[1]) * t),
    Math.round(color[2] + (255 - color[2]) * t),
  ];
}

// ---------------------------------------------------------------------------
// Formatting (Intl everywhere — no ad-hoc string math)

export function fmtMoney(n: unknown, currency = "USD", digits = 2): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(digits)}`;
  }
}

export function fmtNum(n: unknown, digits = 0): string {
  const v = Number(n);
  if (n === null || n === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** Fraction (0–1) rendered as a percentage. */
export function fmtPct(n: unknown, digits = 1): string {
  const v = Number(n);
  if (n === null || n === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string | null | undefined, pattern = "PP"): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), pattern);
  } catch {
    try {
      return format(new Date(iso), pattern);
    } catch {
      return sanitize(iso);
    }
  }
}

// ---------------------------------------------------------------------------
// Images

export async function fetchImageDataUrl(url: string | null | undefined): Promise<string | null> {
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

export function imageFormat(dataUrl: string): "PNG" | "JPEG" {
  return /^data:image\/jpe?g/.test(dataUrl) ? "JPEG" : "PNG";
}

/** Logo box that preserves aspect ratio inside a max height/width. */
export function fitLogo(
  doc: jsPDF,
  dataUrl: string,
  maxH: number,
  maxW: number,
): { w: number; h: number } {
  let ratio = 3;
  try {
    const props = doc.getImageProperties(dataUrl);
    if (props?.width && props?.height) ratio = props.width / props.height;
  } catch {
    // fall back to a sane wordmark ratio
  }
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return { w, h };
}

// ---------------------------------------------------------------------------
// Theme

export interface BrandingInput {
  primaryColor?: string | null;
  accentColor?: string | null;
  footerText?: string | null;
  logoSignedUrl?: string | null;
  logoDataUrl?: string | null;
}

export interface ExportTheme {
  primary: Rgb;
  accent: Rgb;
  logoDataUrl: string | null;
  /** Left footer slot — registered legal name. */
  footerLeft: string;
  /** Center footer slot — company_branding.footer_text. */
  footerCenter: string;
}

export async function createExportTheme(
  branding: BrandingInput | null | undefined,
  company: { name?: string | null; legal_name?: string | null; legalName?: string | null },
): Promise<ExportTheme> {
  const logo =
    branding?.logoDataUrl ?? (await fetchImageDataUrl(branding?.logoSignedUrl ?? null)) ?? null;
  return {
    primary: hexToRgb(branding?.primaryColor, DEFAULT_PRIMARY),
    accent: hexToRgb(branding?.accentColor, DEFAULT_ACCENT),
    logoDataUrl: logo,
    footerLeft: sanitize(company.legal_name ?? company.legalName ?? company.name ?? ""),
    footerCenter: sanitize(branding?.footerText ?? ""),
  };
}

/** Synchronous variant for callers that already hold a logo data URL. */
export function createExportThemeSync(
  branding: BrandingInput | null | undefined,
  company: { name?: string | null; legal_name?: string | null; legalName?: string | null },
): ExportTheme {
  return {
    primary: hexToRgb(branding?.primaryColor, DEFAULT_PRIMARY),
    accent: hexToRgb(branding?.accentColor, DEFAULT_ACCENT),
    logoDataUrl: branding?.logoDataUrl ?? null,
    footerLeft: sanitize(company.legal_name ?? company.legalName ?? company.name ?? ""),
    footerCenter: sanitize(branding?.footerText ?? ""),
  };
}

export function createDoc(): jsPDF {
  return new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
}

export function contentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * PAGE.margin;
}

// ---------------------------------------------------------------------------
// Header band + footer

/**
 * Primary header band with logo left and document title right.
 * Returns the y coordinate where page content may start.
 */
export function drawHeaderBand(
  doc: jsPDF,
  theme: ExportTheme,
  title: string,
  subtitle?: string | null,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const h = PAGE.headerHeight;

  doc.setFillColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.rect(0, 0, pageW, h, "F");

  // Thin accent rule directly under the band.
  doc.setFillColor(theme.accent[0], theme.accent[1], theme.accent[2]);
  doc.rect(0, h, pageW, PAGE.accentRule, "F");

  if (theme.logoDataUrl) {
    try {
      const { w, h: lh } = fitLogo(doc, theme.logoDataUrl, PAGE.logoMaxHeight, mm(45));
      doc.addImage(
        theme.logoDataUrl,
        imageFormat(theme.logoDataUrl),
        PAGE.margin,
        (h - lh) / 2,
        w,
        lh,
        undefined,
        "FAST",
      );
    } catch {
      // a broken logo must never break a document
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  const titleY = subtitle ? h / 2 - 1 : h / 2 + 4;
  doc.text(sanitize(title), pageW - PAGE.margin, titleY, { align: "right" });
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.caption);
    doc.text(sanitize(subtitle), pageW - PAGE.margin, h / 2 + 11, { align: "right" });
  }
  resetInk(doc);

  return h + PAGE.accentRule + mm(10);
}

/** Footer on every page: legal name left, footer text center, Page X of Y right. */
export function drawFooters(doc: jsPDF, theme: ExportTheme): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.footer);
    doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
    doc.setDrawColor(NEUTRAL.line[0], NEUTRAL.line[1], NEUTRAL.line[2]);
    doc.setLineWidth(0.5);
    doc.line(
      PAGE.margin,
      pageH - PAGE.footerBaseline - 10,
      pageW - PAGE.margin,
      pageH - PAGE.footerBaseline - 10,
    );
    if (theme.footerLeft) doc.text(theme.footerLeft, PAGE.margin, pageH - PAGE.footerBaseline);
    if (theme.footerCenter) {
      doc.text(theme.footerCenter, pageW / 2, pageH - PAGE.footerBaseline, { align: "center" });
    }
    doc.text(`Page ${i} of ${total}`, pageW - PAGE.margin, pageH - PAGE.footerBaseline, {
      align: "right",
    });
  }
  resetInk(doc);
}

/** Bottom-of-cover full-width band (subtle, primary-tinted). */
export function drawCoverFooterBand(doc: jsPDF, theme: ExportTheme, label?: string): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bandH = mm(14);
  const soft = tint(theme.primary, 0.9);
  doc.setFillColor(soft[0], soft[1], soft[2]);
  doc.rect(0, pageH - bandH - mm(18), pageW, bandH, "F");
  doc.setFillColor(theme.accent[0], theme.accent[1], theme.accent[2]);
  doc.rect(0, pageH - bandH - mm(18), pageW, 1.2, "F");
  if (label) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.caption);
    doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.text(sanitize(label), PAGE.margin, pageH - bandH - mm(18) + bandH / 2 + 3);
    resetInk(doc);
  }
}

export function resetInk(doc: jsPDF): void {
  doc.setTextColor(NEUTRAL.body[0], NEUTRAL.body[1], NEUTRAL.body[2]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.body);
}

// ---------------------------------------------------------------------------
// Headings & body text

export function docH1(doc: jsPDF, text: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h1);
  doc.setTextColor(NEUTRAL.ink[0], NEUTRAL.ink[1], NEUTRAL.ink[2]);
  doc.text(sanitize(text), PAGE.margin, y);
  resetInk(doc);
  return y + mm(7);
}

export function docH2(doc: jsPDF, theme: ExportTheme, text: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
  doc.text(sanitize(text), PAGE.margin, y);
  resetInk(doc);
  return y + mm(6);
}

export function docBody(doc: jsPDF, text: string, y: number, width?: number): number {
  resetInk(doc);
  const lines = doc.splitTextToSize(sanitize(text), width ?? contentWidth(doc));
  doc.text(lines, PAGE.margin, y);
  return y + lines.length * (FONT.body + 3);
}

export function docCaption(doc: jsPDF, text: string, y: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.caption);
  doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
  doc.text(sanitize(text), PAGE.margin, y);
  resetInk(doc);
  return y + mm(5);
}

/** Page-break helper: ensures `need` points remain before the footer. */
export function ensureSpace(
  doc: jsPDF,
  theme: ExportTheme,
  y: number,
  need: number,
  title?: string,
): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need <= pageH - PAGE.footerBaseline - mm(8)) return y;
  doc.addPage();
  return title ? drawHeaderBand(doc, theme, title) : PAGE.margin;
}

// ---------------------------------------------------------------------------
// KPI "big number" blocks

export interface BigNumber {
  label: string;
  value: string;
  hint?: string | null;
}

/**
 * Uniform big-number blocks across the content width.
 * value = 20pt bold in primary, label = 7.5pt uppercase muted.
 */
export function drawBigNumbers(
  doc: jsPDF,
  theme: ExportTheme,
  items: BigNumber[],
  y: number,
  opts?: { perRow?: number; height?: number },
): number {
  if (items.length === 0) return y;
  const perRow = Math.min(opts?.perRow ?? Math.min(items.length, 4), 6);
  const boxH = opts?.height ?? mm(22);
  const gutter = mm(4);
  const width = contentWidth(doc);
  const boxW = (width - gutter * (perRow - 1)) / perRow;
  const rows = Math.ceil(items.length / perRow);

  for (let r = 0; r < rows; r++) {
    const rowItems = items.slice(r * perRow, (r + 1) * perRow);
    const top = y + r * (boxH + gutter);
    rowItems.forEach((item, i) => {
      const x = PAGE.margin + i * (boxW + gutter);
      doc.setFillColor(NEUTRAL.stripe[0], NEUTRAL.stripe[1], NEUTRAL.stripe[2]);
      doc.setDrawColor(NEUTRAL.line[0], NEUTRAL.line[1], NEUTRAL.line[2]);
      doc.setLineWidth(0.6);
      doc.rect(x, top, boxW, boxH, "FD");
      // accent tick on the left edge
      doc.setFillColor(theme.accent[0], theme.accent[1], theme.accent[2]);
      doc.rect(x, top, 2, boxH, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(FONT.kpiLabel);
      doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
      const label = doc.splitTextToSize(sanitize(item.label).toUpperCase(), boxW - mm(7))[0];
      doc.text(label, x + mm(4), top + mm(5.5));

      doc.setFont("helvetica", "bold");
      doc.setFontSize(FONT.kpiValue);
      doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
      const value = doc.splitTextToSize(sanitize(item.value), boxW - mm(6))[0];
      doc.text(value, x + mm(4), top + mm(14));

      if (item.hint) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(FONT.caption);
        doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
        const hint = doc.splitTextToSize(sanitize(item.hint), boxW - mm(6))[0];
        doc.text(hint, x + mm(4), top + mm(19));
      }
    });
  }
  resetInk(doc);
  return y + rows * (boxH + gutter);
}

/** Two-column definition block (e.g. vendor / ship-to headers). */
export function drawTwoColumnBlock(
  doc: jsPDF,
  theme: ExportTheme,
  left: { title: string; lines: string[] },
  right: { title: string; lines: string[] },
  y: number,
): number {
  const width = contentWidth(doc);
  const gutter = mm(6);
  const colW = (width - gutter) / 2;
  const lineH = FONT.body + 3.5;
  const rows = Math.max(left.lines.length, right.lines.length);
  const boxH = mm(9) + rows * lineH + mm(3);

  [left, right].forEach((col, i) => {
    const x = PAGE.margin + i * (colW + gutter);
    doc.setFillColor(NEUTRAL.stripe[0], NEUTRAL.stripe[1], NEUTRAL.stripe[2]);
    doc.setDrawColor(NEUTRAL.line[0], NEUTRAL.line[1], NEUTRAL.line[2]);
    doc.setLineWidth(0.6);
    doc.rect(x, y, colW, boxH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.kpiLabel);
    doc.setTextColor(theme.primary[0], theme.primary[1], theme.primary[2]);
    doc.text(sanitize(col.title).toUpperCase(), x + mm(4), y + mm(6));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.body);
    doc.setTextColor(NEUTRAL.body[0], NEUTRAL.body[1], NEUTRAL.body[2]);
    col.lines.forEach((raw, idx) => {
      const line = doc.splitTextToSize(sanitize(raw), colW - mm(8))[0] ?? "";
      doc.text(line, x + mm(4), y + mm(11) + idx * lineH);
    });
  });
  resetInk(doc);
  return y + boxH + mm(5);
}

// ---------------------------------------------------------------------------
// Tables (autotable standard)

export interface DocTableOptions extends Omit<UserOptions, "didParseCell" | "didDrawPage"> {
  /** Row indexes (into `body`) rendered as bold totals rows with a top border. */
  totalRows?: number[];
  /** Row indexes (into `body`) rendered as tinted section sub-headers. */
  sectionRows?: number[];
  /**
   * Document title/subtitle re-drawn as the branded header band on every
   * continuation page the table spills onto. Always pass this so long tables
   * keep the header/footer family intact.
   */
  pageHeader?: { title: string; subtitle?: string | null };
  didParseCell?: UserOptions["didParseCell"];
  didDrawPage?: UserOptions["didDrawPage"];
}

/**
 * Shared autotable standard: primary header fill, white 8.5pt semibold heads,
 * alternating stripes, light rules, generous padding, totals/section rows.
 * Rows never split across pages, and continuation pages get the header band.
 */
export function docTable(doc: jsPDF, theme: ExportTheme, options: DocTableOptions): number {
  const {
    totalRows = [],
    sectionRows = [],
    pageHeader,
    didParseCell,
    didDrawPage,
    margin: marginOverride,
    ...rest
  } = options;
  const sectionFill = tint(theme.primary, 0.9);
  const contentTop = PAGE.headerHeight + PAGE.accentRule + mm(10);
  let firstPageDrawn = false;

  autoTable(doc, {
    theme: "grid",
    // Reserve the header band on continuation pages and keep clear of the footer.
    margin: {
      left: PAGE.margin,
      right: PAGE.margin,
      top: pageHeader ? contentTop : PAGE.margin,
      bottom: PAGE.footerBaseline + mm(8),
      ...(typeof marginOverride === "object" && marginOverride !== null ? marginOverride : {}),
    },
    rowPageBreak: "avoid",
    tableWidth: "auto",
    styles: {
      font: "helvetica",
      fontSize: FONT.tableBody,
      cellPadding: { top: mm(1.8), right: mm(2), bottom: mm(1.8), left: mm(2) },
      lineColor: NEUTRAL.line as Rgb,
      lineWidth: 0.4,
      textColor: NEUTRAL.body as Rgb,
      overflow: "linebreak",
      valign: "middle",
      ...(rest.styles ?? {}),
    },
    headStyles: {
      fillColor: theme.primary as Rgb,
      textColor: 255,
      fontStyle: "bold",
      fontSize: FONT.tableHead,
      halign: "left",
      cellPadding: { top: mm(2.2), right: mm(2), bottom: mm(2.2), left: mm(2) },
      lineColor: theme.primary as Rgb,
      ...(rest.headStyles ?? {}),
    },
    bodyStyles: { fillColor: NEUTRAL.white as Rgb, ...(rest.bodyStyles ?? {}) },
    alternateRowStyles: {
      fillColor: NEUTRAL.stripe as Rgb,
      ...(rest.alternateRowStyles ?? {}),
    },
    footStyles: {
      fillColor: NEUTRAL.white as Rgb,
      textColor: NEUTRAL.ink as Rgb,
      fontStyle: "bold",
      ...(rest.footStyles ?? {}),
    },
    didParseCell: (data: CellHookData) => {
      if (data.section === "body") {
        const idx = data.row.index;
        if (sectionRows.includes(idx)) {
          data.cell.styles.fillColor = sectionFill as Rgb;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = theme.primary as Rgb;
        }
        if (totalRows.includes(idx)) {
          data.cell.styles.fillColor = NEUTRAL.white as Rgb;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = NEUTRAL.ink as Rgb;
          data.cell.styles.lineWidth = { top: 1.5, right: 0, bottom: 0, left: 0 } as never;
          data.cell.styles.lineColor = NEUTRAL.ink as Rgb;
        }
      }
      didParseCell?.(data);
    },
    didDrawPage: (data) => {
      // First page keeps whatever the caller already drew; continuation pages
      // get the branded header band so every page matches the family.
      if (pageHeader) {
        if (firstPageDrawn) drawHeaderBand(doc, theme, pageHeader.title, pageHeader.subtitle);
        firstPageDrawn = true;
      }
      didDrawPage?.(data);
    },
    ...rest,
  });

  return tableEndY(doc, (rest.startY as number) ?? PAGE.margin);
}

/** Right-aligned numeric column style helper. */
export const numericCol = { halign: "right" as const };

export function tableEndY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return typeof last?.finalY === "number" ? last.finalY : fallback;
}

// ---------------------------------------------------------------------------
// Filenames

export function slugify(s: string, max = 40): string {
  return (
    (s || "untitled")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max) || "untitled"
  );
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PPTX theme (shared with the proposal deck)

export const PPTX = {
  /** 13.33 x 7.5 in (16:9). */
  slideW: 13.333,
  slideH: 7.5,
  margin: 0.6,
  headerH: 0.72,
  footerY: 6.95,
  gutter: 0.5,
  /** 12-column grid helper. */
  col(span: number, offset = 0, gutter = 0.5, margin = 0.6, slideW = 13.333) {
    const inner = slideW - margin * 2;
    const colW = (inner - gutter * 11) / 12;
    return {
      x: margin + offset * (colW + gutter),
      w: span * colW + (span - 1) * gutter,
    };
  },
  font: { display: "Arial", body: "Arial" },
  size: { title: 32, slideTitle: 24, section: 20, body: 14, caption: 10, kpi: 30, kpiLabel: 9 },
} as const;

/** Branded chart series colours: primary + two accents from the token family. */
export function pptxSeriesColors(theme: ExportTheme): string[] {
  return [
    rgbToHex(theme.primary),
    rgbToHex(theme.accent),
    rgbToHex(tint(theme.primary, 0.45)),
    rgbToHex(tint(theme.accent, 0.5)),
  ];
}
