// P-048 / POL-4 — Client-side branded proposal PPTX builder (pptxgenjs).
// Built on the shared export theme (src/lib/exports/theme.ts) so the deck
// reads as the same family as the PDF exports: same brand colours, same
// header/footer contract, same number formatting, same "O&M"/"C&I" handling.
import PptxGenJS from "pptxgenjs";
import { format, parseISO } from "date-fns";
import {
  PPTX,
  pptxSeriesColors,
  rgbToHex,
  tint,
  sanitize,
  fmtMoney,
  fmtDate as themeFmtDate,
  slugify,
  createExportThemeSync,
  type ExportTheme,
} from "./theme";

const DEFAULT_FONT = "Arial";

export interface ProposalPptxData {
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
    fontFamily?: string | null;
  };
  yieldResult: any | null;
  salesOwner: { full_name: string | null; email: string | null } | null;
  tenderEvents: Array<{
    event_type: string;
    title: string | null;
    event_at: string;
    notes: string | null;
  }>;
}

/** Trim + sanitize, guarding against slide overflow on long free-text fields. */
function clip(v: unknown, max = 600): string {
  const s = sanitize(v);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

async function fetchLogoDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function fmtDate(v: string | null | undefined): string {
  return themeFmtDate(v ?? null, "PP");
}

/** Grid-aligned column helper: PPTX.col() gives {x, w}; we always pass y/h. */
function gridBox(span: number, offset: number, y: number, h: number) {
  return { ...PPTX.col(span, offset), y, h };
}

export async function buildProposalPptx(
  data: ProposalPptxData,
): Promise<{ blob: Blob; filename: string }> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in — matches PPTX.slideW/slideH

  const logoDataUrl = await fetchLogoDataUrl(data.branding.logoSignedUrl);
  const theme: ExportTheme = createExportThemeSync({ ...data.branding, logoDataUrl }, data.company);
  const primary = rgbToHex(theme.primary);
  const accent = rgbToHex(theme.accent);
  const seriesColors = pptxSeriesColors(theme);
  const font = sanitize(data.branding.fontFamily) || DEFAULT_FONT;
  const legalName = theme.footerLeft;
  const footerText = theme.footerCenter || legalName;
  const contentX = PPTX.margin;
  const contentW = PPTX.slideW - PPTX.margin * 2;

  // --- Slide master --------------------------------------------------------
  // Header band (primary) + accent rule + logo left + footer rule with legal
  // name / footer text / slide number, exactly like the PDF family.
  const masterObjects: PptxGenJS.SlideMasterProps["objects"] = [
    {
      rect: {
        x: 0,
        y: 0,
        w: PPTX.slideW,
        h: PPTX.headerH,
        fill: { color: primary },
        line: { color: primary, width: 0 },
      },
    },
    {
      rect: {
        x: 0,
        y: PPTX.headerH,
        w: PPTX.slideW,
        h: 0.03,
        fill: { color: accent },
        line: { color: accent, width: 0 },
      },
    },
    {
      line: {
        x: contentX,
        y: PPTX.footerY - 0.08,
        w: contentW,
        h: 0,
        line: { color: "DEDEE2", width: 0.75 },
      },
    },
    {
      text: {
        text: footerText,
        options: {
          x: contentX,
          y: PPTX.footerY,
          w: contentW * 0.55,
          h: 0.32,
          fontSize: PPTX.size.caption,
          fontFace: font,
          color: "78808C",
        },
      },
    },
    {
      text: {
        text: footerText === legalName ? "" : legalName,
        options: {
          x: contentX + contentW * 0.3,
          y: PPTX.footerY,
          w: contentW * 0.4,
          h: 0.32,
          fontSize: PPTX.size.caption,
          fontFace: font,
          color: "78808C",
          align: "center",
        },
      },
    },
  ];
  if (logoDataUrl) {
    masterObjects.push({
      image: {
        x: PPTX.slideW - PPTX.margin - 1.3,
        y: 0.12,
        w: 1.3,
        h: PPTX.headerH - 0.24,
        data: logoDataUrl,
        sizing: { type: "contain", w: 1.3, h: PPTX.headerH - 0.24 },
      },
    });
  }
  pptx.defineSlideMaster({
    title: "GM_MASTER",
    background: { color: "FFFFFF" },
    objects: masterObjects,
    slideNumber: {
      x: PPTX.slideW - PPTX.margin - 0.6,
      y: PPTX.footerY,
      w: 0.6,
      h: 0.32,
      fontSize: PPTX.size.caption,
      fontFace: font,
      color: "78808C",
      align: "right",
    },
  });

  const p = data.proposal ?? {};
  const opp = data.opportunity ?? {};
  const cfg = (p.array_config ?? {}) as any;
  const yr = data.yieldResult ?? null;
  const currency = sanitize(p.currency_code) || "USD";

  const titleBar = (slide: PptxGenJS.Slide, title: string) => {
    slide.addText(clip(title, 90), {
      x: contentX,
      y: 0,
      w: contentW - 1.5,
      h: PPTX.headerH,
      fontSize: PPTX.size.slideTitle,
      bold: true,
      color: "FFFFFF",
      fontFace: font,
      valign: "middle",
    });
  };

  const contentTop = PPTX.headerH + 0.28;

  // --- Table style shared with PDF family (primary head, alt-row body) -----
  const tableHeadOptions = {
    bold: true,
    fontSize: 10,
    color: "FFFFFF",
    fill: { color: primary },
  } as const;
  const tableLabelOptions = {
    fontSize: 12,
    color: "374151",
    fill: { color: "F3F4F6" },
  } as const;
  const tableValueOptions = {
    fontSize: 12,
    color: "1F2937",
  } as const;
  const numericOptions = { align: "right" as const };

  /** Section divider slide between major parts of the deck. */
  const addDivider = (title: string, subtitle?: string) => {
    const s = pptx.addSlide();
    s.background = { color: primary };
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: PPTX.slideH / 2 - 0.02,
      w: 1.6,
      h: 0.05,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    });
    s.addText(clip(title, 70), {
      x: contentX,
      y: PPTX.slideH / 2 - 0.9,
      w: contentW,
      h: 0.9,
      fontSize: PPTX.size.section + 8,
      bold: true,
      color: "FFFFFF",
      fontFace: font,
    });
    if (subtitle) {
      s.addText(clip(subtitle, 120), {
        x: contentX,
        y: PPTX.slideH / 2 + 0.15,
        w: contentW,
        h: 0.5,
        fontSize: PPTX.size.body,
        color: rgbToHex(tint(theme.primary, 0.65)),
        fontFace: font,
      });
    }
  };

  // --- Slide 1: Title (dark/primary background, centered logo) ------------
  {
    const s = pptx.addSlide();
    s.background = { color: primary };
    if (logoDataUrl) {
      s.addImage({
        data: logoDataUrl,
        x: PPTX.slideW / 2 - 1.1,
        y: 0.9,
        w: 2.2,
        h: 1.0,
        sizing: { type: "contain", w: 2.2, h: 1.0 },
      });
    }
    s.addText(clip(p.title || "Proposal", 100), {
      x: contentX,
      y: 2.5,
      w: contentW,
      h: 1.3,
      fontSize: PPTX.size.title,
      bold: true,
      color: "FFFFFF",
      fontFace: font,
      align: "center",
      valign: "middle",
    });
    s.addText(`${clip(opp.account_name, 80) || "—"}   ·   ${format(new Date(), "PP")}`, {
      x: contentX,
      y: 3.85,
      w: contentW,
      h: 0.5,
      fontSize: PPTX.size.body + 4,
      color: rgbToHex(tint(theme.primary, 0.6)),
      fontFace: font,
      align: "center",
    });
    s.addText(
      [
        { text: "Valid until: ", options: { bold: true } },
        { text: fmtDate(p.valid_until), options: {} },
        { text: "     Version: ", options: { bold: true } },
        { text: `v${p.version ?? 1}`, options: {} },
      ],
      {
        x: contentX,
        y: 4.45,
        w: contentW,
        h: 0.4,
        fontSize: PPTX.size.caption + 2,
        color: rgbToHex(tint(theme.primary, 0.75)),
        fontFace: font,
        align: "center",
      },
    );
    s.addShape(pptx.ShapeType.rect, {
      x: PPTX.slideW / 2 - 1.0,
      y: 5.05,
      w: 2.0,
      h: 0.04,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    });
  }

  // --- Divider: Company & solution ------------------------------------------
  addDivider("Company & solution", legalName || undefined);

  // --- Slide: About us -------------------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "About us");
    const blurb =
      clip(data.branding.footerText, 500) ||
      `${legalName} — full-lifecycle EPC delivery across origination, engineering, procurement, construction and O&M.`;
    s.addText(blurb, {
      ...gridBox(7, 0, contentTop, 4.5),
      fontSize: PPTX.size.body + 2,
      color: "1F2937",
      fontFace: font,
      valign: "top",
    });
    const contact: PptxGenJS.TextProps[] = [
      { text: "Contact", options: { bold: true, fontSize: 14, color: primary } },
      { text: "\n", options: { breakLine: true } },
    ];
    if (data.company.contact_email) {
      contact.push({
        text: `${clip(data.company.contact_email, 120)}\n`,
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      });
    }
    if (data.company.phone) {
      contact.push({
        text: `${clip(data.company.phone, 60)}\n`,
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      });
    }
    if (data.company.address) {
      contact.push({
        text: clip(data.company.address, 200),
        options: { fontSize: 14, color: "1F2937" },
      });
    }
    s.addText(contact, {
      ...gridBox(5, 7, contentTop, 4.5),
      fontFace: font,
      valign: "top",
    });
  }

  // --- Slide: Solution --------------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Solution");
    const rows: Array<[string, string]> = [
      ["Archetype", clip(cfg.archetype ?? p.archetype ?? "—", 60)],
      ["AC Capacity", cfg.ac_capacity_mw != null ? `${cfg.ac_capacity_mw} MW` : "—"],
      ["DC Capacity", cfg.dc_capacity_mw != null ? `${cfg.dc_capacity_mw} MW` : "—"],
      ["Storage", cfg.storage_capacity_mwh != null ? `${cfg.storage_capacity_mwh} MWh` : "—"],
      ["Tracking", clip(cfg.tracking ?? "—", 60)],
      ["Tilt", cfg.tilt_deg != null ? `${cfg.tilt_deg}°` : "—"],
      ["GCR", cfg.gcr != null ? String(cfg.gcr) : "—"],
      ["Module", clip(cfg.module ?? "—", 80)],
      ["Inverter", clip(cfg.inverter ?? "—", 80)],
    ];
    const tableRows: PptxGenJS.TableRow[] = rows.map(([k, v]) => [
      { text: k, options: { ...tableLabelOptions, bold: true } },
      { text: v, options: tableValueOptions },
    ]);
    const { x, w } = gridBox(12, 0, contentTop, 0);
    s.addTable(tableRows, {
      x,
      y: contentTop,
      w,
      colW: [w * 0.34, w * 0.66],
      fontFace: font,
      border: { pt: 0.5, color: "E5E7EB" },
      rowH: 0.42,
    });
  }

  // --- Slide: Energy yield (KPI tiles + branded chart) --------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Energy yield");

    const p50 = yr?.p50_gwh_yr ?? yr?.p50 ?? null;
    const p90 = yr?.p90_gwh_yr ?? yr?.p90 ?? null;
    const specific = yr?.specific_yield_kwh_kwp ?? yr?.specific_yield ?? null;
    const tiles: Array<{ label: string; value: string }> = [
      { label: "P50 (GWh/yr)", value: p50 != null ? Number(p50).toFixed(1) : "—" },
      { label: "P90 (GWh/yr)", value: p90 != null ? Number(p90).toFixed(1) : "—" },
      {
        label: "Specific yield (kWh/kWp)",
        value: specific != null ? Number(specific).toFixed(0) : "—",
      },
    ];
    const tileY = contentTop;
    const tileH = 1.5;
    tiles.forEach((t, i) => {
      const { x, w } = PPTX.col(4, i * 4);
      s.addShape(pptx.ShapeType.roundRect, {
        x,
        y: tileY,
        w,
        h: tileH,
        fill: { color: primary },
        line: { color: primary, width: 0 },
        rectRadius: 0.12,
      });
      s.addText(t.value, {
        x,
        y: tileY + 0.05,
        w,
        h: 0.9,
        fontSize: PPTX.size.kpi + 6,
        bold: true,
        color: "FFFFFF",
        fontFace: font,
        align: "center",
        valign: "middle",
      });
      s.addText(t.label, {
        x,
        y: tileY + 0.95,
        w,
        h: 0.5,
        fontSize: PPTX.size.kpiLabel + 3,
        color: "E5E7EB",
        fontFace: font,
        align: "center",
      });
    });

    const chartTop = tileY + tileH + 0.4;
    const monthly: number[] | null = Array.isArray(yr?.monthly)
      ? (yr!.monthly as any[]).map((m: any) =>
          typeof m === "number" ? m : Number(m?.p50 ?? m?.gwh ?? 0),
        )
      : null;
    if (monthly && monthly.length === 12) {
      const labels = [
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
      const { x, w } = gridBox(12, 0, chartTop, 0);
      s.addChart(pptx.ChartType.bar, [{ name: "Monthly P50 (GWh)", labels, values: monthly }], {
        x,
        y: chartTop,
        w,
        h: PPTX.footerY - chartTop - 0.35,
        barDir: "col",
        chartColors: seriesColors,
        showLegend: false,
        showTitle: false,
        catAxisLabelFontFace: font,
        valAxisLabelFontFace: font,
        catAxisLabelFontSize: 10,
        valAxisLabelFontSize: 10,
      });
    } else {
      const { x, w } = gridBox(12, 0, chartTop + 0.6, 0);
      s.addText("Yield simulation pending", {
        x,
        y: chartTop + 0.6,
        w,
        h: 1.5,
        fontSize: 20,
        italic: true,
        color: "9CA3AF",
        align: "center",
        fontFace: font,
      });
    }

    s.addText("gridmind-stub-v1 (placeholder)", {
      x: contentX,
      y: PPTX.footerY - 0.35,
      w: contentW,
      h: 0.3,
      fontSize: 10,
      italic: true,
      color: "9CA3AF",
      fontFace: font,
    });
  }

  // --- Divider: Commercial & timeline ---------------------------------------
  addDivider("Commercial & timeline");

  // --- Slide: Commercial summary (PDF-style table: header fill, alt rows) --
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Commercial summary");
    const contingencyPct = Number(p.contingency_pct ?? 0);
    const subtotal = Number(p.subtotal ?? 0);
    const contingencyAmt = subtotal * (contingencyPct / 100);
    const rows: PptxGenJS.TableRow[] = [
      [
        { text: "Line item", options: tableHeadOptions },
        { text: "Amount", options: { ...tableHeadOptions, ...numericOptions } },
      ],
      [
        { text: "Subtotal", options: tableLabelOptions },
        {
          text: fmtMoney(subtotal, currency, 0),
          options: { ...tableValueOptions, ...numericOptions },
        },
      ],
      [
        { text: `Contingency (${contingencyPct.toFixed(1)}%)`, options: tableLabelOptions },
        {
          text: fmtMoney(contingencyAmt, currency, 0),
          options: { ...tableValueOptions, ...numericOptions },
        },
      ],
      [
        {
          text: "Total",
          options: { bold: true, fontSize: 16, color: "FFFFFF", fill: { color: primary } },
        },
        {
          text: fmtMoney(p.total, currency, 0),
          options: {
            bold: true,
            fontSize: 16,
            color: "FFFFFF",
            fill: { color: primary },
            ...numericOptions,
          },
        },
      ],
      [
        { text: "Currency", options: { ...tableLabelOptions, fill: { color: "FFFFFF" } } },
        { text: currency, options: { ...tableValueOptions, ...numericOptions } },
      ],
      [
        { text: "Validity", options: { ...tableLabelOptions, fill: { color: "F3F4F6" } } },
        { text: fmtDate(p.valid_until), options: { ...tableValueOptions, ...numericOptions } },
      ],
    ];
    const { x, w } = gridBox(12, 0, contentTop, 0);
    s.addTable(rows, {
      x,
      y: contentTop,
      w,
      colW: [w * 0.6, w * 0.4],
      fontFace: font,
      border: { pt: 0.5, color: "E5E7EB" },
      rowH: 0.5,
    });
  }

  // --- Slide: Timeline & tender dates ----------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Timeline & tender dates");
    if (data.tenderEvents.length === 0) {
      s.addText("No upcoming tender events", {
        ...gridBox(12, 0, 2.0, 1.0),
        fontSize: 20,
        italic: true,
        color: "9CA3AF",
        align: "center",
        fontFace: font,
      });
    } else {
      const bullets: PptxGenJS.TextProps[] = data.tenderEvents.slice(0, 10).flatMap((e) => {
        const head = `${clip(e.event_type, 40).replace(/_/g, " ").toUpperCase()} — ${fmtDate(e.event_at)}`;
        const parts: PptxGenJS.TextProps[] = [
          {
            text: head,
            options: {
              bold: true,
              fontSize: 14,
              color: primary,
              bullet: { code: "25A0" },
              breakLine: true,
            },
          },
        ];
        const detail = clip(e.title ?? e.notes ?? "", 200);
        if (detail) {
          parts.push({
            text: `   ${detail}`,
            options: { fontSize: 13, color: "374151", breakLine: true },
          });
        }
        parts.push({ text: " ", options: { fontSize: 6, breakLine: true } });
        return parts;
      });
      s.addText(bullets, {
        ...gridBox(12, 0, contentTop, 5.5),
        fontFace: font,
        valign: "top",
      });
    }
  }

  // --- Divider: Terms ---------------------------------------------------
  addDivider("Terms & contact");

  // --- Slide: Terms & contact ------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Terms & contact");
    const notes =
      clip(p.notes, 700) || "Standard EPC terms apply. Pricing valid through the date shown below.";
    s.addText(notes, {
      ...gridBox(12, 0, contentTop, 3.0),
      fontSize: 14,
      color: "1F2937",
      fontFace: font,
      valign: "top",
    });
    s.addText(`Validity: ${fmtDate(p.valid_until)}`, {
      ...gridBox(12, 0, contentTop + 3.1, 0.4),
      fontSize: 14,
      bold: true,
      color: "374151",
      fontFace: font,
    });

    const owner = data.salesOwner;
    const contactParts: PptxGenJS.TextProps[] = [
      {
        text: "Sales owner",
        options: { bold: true, fontSize: 14, color: primary, breakLine: true },
      },
      {
        text: clip(owner?.full_name, 100) || "—",
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      },
    ];
    if (owner?.email) {
      contactParts.push({
        text: clip(owner.email, 100),
        options: { fontSize: 14, color: "1F2937" },
      });
    }
    s.addText(contactParts, {
      ...gridBox(12, 0, contentTop + 3.9, 1.5),
      fontFace: font,
      valign: "top",
    });
  }

  // Filename ---------------------------------------------------------------
  const filename = `GridMind_Proposal_${slugify(sanitize(opp.account_name), 40)}_${slugify(sanitize(p.title), 40)}_v${p.version ?? 1}.pptx`;

  const out = (await pptx.write({ outputType: "blob" })) as Blob;
  return { blob: out, filename };
}

export { downloadBlob } from "./theme";
