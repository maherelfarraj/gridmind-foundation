// P-048 — Client-side branded proposal PPTX builder (pptxgenjs).
import PptxGenJS from "pptxgenjs";
import { format, parseISO } from "date-fns";

const DEFAULT_PRIMARY = "#1e40af";
const DEFAULT_ACCENT = "#0d9488";
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

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  // pptxgenjs escapes for XML itself — strip any pre-encoded artefacts so
  // "O&M" / "C&I" render with a plain ampersand.
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&;/g, "&");
}

function normalizeHex(hex: string | null | undefined, fallback: string): string {
  const s = (hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  return (m ? m[1] : fallback.replace(/^#/, "")).toUpperCase();
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

function slug(v: unknown, max = 60): string {
  const s = String(v ?? "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return s || "proposal";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return format(parseISO(v), "PP");
  } catch {
    return clean(v);
  }
}

function fmtMoney(v: number | null | undefined, currency: string): string {
  const n = Number(v ?? 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export async function buildProposalPptx(
  data: ProposalPptxData,
): Promise<{ blob: Blob; filename: string }> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in

  const primary = normalizeHex(data.branding.primaryColor, DEFAULT_PRIMARY);
  const accent = normalizeHex(data.branding.accentColor, DEFAULT_ACCENT);
  const font = clean(data.branding.fontFamily) || DEFAULT_FONT;
  const logoDataUrl = await fetchLogoDataUrl(data.branding.logoSignedUrl);
  const legalName = clean(data.company.legal_name || data.company.name);
  const footerText = clean(data.branding.footerText) || legalName;

  // --- Master slide -------------------------------------------------------
  const masterObjects: any[] = [
    // Top title bar
    {
      rect: {
        x: 0,
        y: 0,
        w: 13.333,
        h: 0.6,
        fill: { color: primary },
        line: { color: primary, width: 0 },
      },
    },
    // Footer left — legal name
    {
      text: {
        text: footerText,
        options: {
          x: 0.4,
          y: 7.05,
          w: 8,
          h: 0.35,
          fontSize: 9,
          fontFace: font,
          color: "8A8A8A",
        },
      },
    },
    // Footer right — slide number
    {
      text: {
        text: "Slide ",
        options: {
          x: 11.7,
          y: 7.05,
          w: 1.2,
          h: 0.35,
          fontSize: 9,
          fontFace: font,
          color: "8A8A8A",
          align: "right",
        },
      },
    },
  ];
  if (logoDataUrl) {
    masterObjects.push({
      image: {
        x: 12.2,
        y: 0.1,
        w: 0.9,
        h: 0.4,
        data: logoDataUrl,
        sizing: { type: "contain", w: 0.9, h: 0.4 },
      },
    });
  }
  pptx.defineSlideMaster({
    title: "GM_MASTER",
    background: { color: "FFFFFF" },
    objects: masterObjects,
    slideNumber: {
      x: 12.6,
      y: 7.05,
      w: 0.5,
      h: 0.35,
      fontSize: 9,
      fontFace: font,
      color: "8A8A8A",
      align: "left",
    },
  });

  const p = data.proposal ?? {};
  const opp = data.opportunity ?? {};
  const cfg = (p.array_config ?? {}) as any;
  const yr = data.yieldResult ?? null;
  const currency = clean(p.currency_code) || "USD";

  const titleBar = (slide: PptxGenJS.Slide, title: string) => {
    slide.addText(clean(title), {
      x: 0.4,
      y: 0.05,
      w: 11.5,
      h: 0.5,
      fontSize: 20,
      bold: true,
      color: "FFFFFF",
      fontFace: font,
      valign: "middle",
    });
  };

  // --- Slide 1: Title -----------------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, legalName || "Proposal");
    s.addText(clean(p.title || "Proposal"), {
      x: 0.7,
      y: 1.7,
      w: 12,
      h: 1.4,
      fontSize: 44,
      bold: true,
      color: "1F2937",
      fontFace: font,
    });
    s.addText(`Prepared for ${clean(opp.account_name) || "—"}`, {
      x: 0.7,
      y: 3.1,
      w: 12,
      h: 0.6,
      fontSize: 22,
      color: "374151",
      fontFace: font,
    });
    s.addText(
      [
        { text: "Date: ", options: { bold: true } },
        { text: format(new Date(), "PP"), options: {} },
        { text: "     Valid until: ", options: { bold: true } },
        { text: fmtDate(p.valid_until), options: {} },
        { text: "     Version: ", options: { bold: true } },
        { text: `v${p.version ?? 1}`, options: {} },
      ],
      {
        x: 0.7,
        y: 4.0,
        w: 12,
        h: 0.6,
        fontSize: 16,
        color: "4B5563",
        fontFace: font,
      },
    );
    // Accent underline
    s.addShape(pptx.ShapeType.rect, {
      x: 0.7,
      y: 4.9,
      w: 2.0,
      h: 0.08,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    });
  }

  // --- Slide 2: About us --------------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "About us");
    const blurb =
      clean(data.branding.footerText) ||
      `${legalName} — full-lifecycle EPC delivery across origination, engineering, procurement, construction and O&M.`;
    s.addText(blurb, {
      x: 0.7,
      y: 1.0,
      w: 7.5,
      h: 4.5,
      fontSize: 16,
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
        text: `${clean(data.company.contact_email)}\n`,
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      });
    }
    if (data.company.phone) {
      contact.push({
        text: `${clean(data.company.phone)}\n`,
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      });
    }
    if (data.company.address) {
      contact.push({
        text: clean(data.company.address),
        options: { fontSize: 14, color: "1F2937" },
      });
    }
    s.addText(contact, {
      x: 8.6,
      y: 1.0,
      w: 4.3,
      h: 4.5,
      fontFace: font,
      valign: "top",
    });
  }

  // --- Slide 3: Solution --------------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Solution");
    const rows: Array<[string, string]> = [
      ["Archetype", clean(cfg.archetype ?? p.archetype ?? "—")],
      [
        "AC Capacity",
        cfg.ac_capacity_mw != null ? `${cfg.ac_capacity_mw} MW` : "—",
      ],
      [
        "DC Capacity",
        cfg.dc_capacity_mw != null ? `${cfg.dc_capacity_mw} MW` : "—",
      ],
      [
        "Storage",
        cfg.storage_capacity_mwh != null
          ? `${cfg.storage_capacity_mwh} MWh`
          : "—",
      ],
      ["Tracking", clean(cfg.tracking ?? "—")],
      ["Tilt", cfg.tilt_deg != null ? `${cfg.tilt_deg}°` : "—"],
      ["GCR", cfg.gcr != null ? String(cfg.gcr) : "—"],
      ["Module", clean(cfg.module ?? "—")],
      ["Inverter", clean(cfg.inverter ?? "—")],
    ];
    const tableRows: PptxGenJS.TableRow[] = rows.map(([k, v]) => [
      {
        text: k,
        options: {
          bold: true,
          fontSize: 14,
          color: "374151",
          fill: { color: "F3F4F6" },
        },
      },
      { text: v, options: { fontSize: 14, color: "1F2937" } },
    ]);
    s.addTable(tableRows, {
      x: 0.7,
      y: 1.0,
      w: 11.9,
      colW: [4.0, 7.9],
      fontFace: font,
      border: { pt: 0.5, color: "E5E7EB" },
      rowH: 0.42,
    });
  }

  // --- Slide 4: Energy yield ---------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Energy yield");

    const p50 = yr?.p50_gwh_yr ?? yr?.p50 ?? null;
    const p90 = yr?.p90_gwh_yr ?? yr?.p90 ?? null;
    const specific = yr?.specific_yield_kwh_kwp ?? yr?.specific_yield ?? null;
    const tiles: Array<{ label: string; value: string }> = [
      {
        label: "P50 (GWh/yr)",
        value: p50 != null ? Number(p50).toFixed(1) : "—",
      },
      {
        label: "P90 (GWh/yr)",
        value: p90 != null ? Number(p90).toFixed(1) : "—",
      },
      {
        label: "Specific yield (kWh/kWp)",
        value: specific != null ? Number(specific).toFixed(0) : "—",
      },
    ];
    tiles.forEach((t, i) => {
      const x = 0.7 + i * 4.05;
      s.addShape(pptx.ShapeType.roundRect, {
        x,
        y: 1.0,
        w: 3.8,
        h: 1.5,
        fill: { color: primary },
        line: { color: primary, width: 0 },
        rectRadius: 0.12,
      });
      s.addText(t.value, {
        x,
        y: 1.05,
        w: 3.8,
        h: 0.9,
        fontSize: 36,
        bold: true,
        color: "FFFFFF",
        fontFace: font,
        align: "center",
        valign: "middle",
      });
      s.addText(t.label, {
        x,
        y: 1.95,
        w: 3.8,
        h: 0.5,
        fontSize: 12,
        color: "E5E7EB",
        fontFace: font,
        align: "center",
      });
    });

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
      s.addChart(
        pptx.ChartType.bar,
        [{ name: "Monthly P50 (GWh)", labels, values: monthly }],
        {
          x: 0.7,
          y: 2.9,
          w: 11.9,
          h: 3.6,
          barDir: "col",
          chartColors: [primary],
          showLegend: false,
          showTitle: false,
          catAxisLabelFontFace: font,
          valAxisLabelFontFace: font,
          catAxisLabelFontSize: 10,
          valAxisLabelFontSize: 10,
        },
      );
    } else {
      s.addText("Yield simulation pending", {
        x: 0.7,
        y: 3.5,
        w: 11.9,
        h: 1.5,
        fontSize: 20,
        italic: true,
        color: "9CA3AF",
        align: "center",
        fontFace: font,
      });
    }

    s.addText("gridmind-stub-v1 (placeholder)", {
      x: 0.7,
      y: 6.6,
      w: 11.9,
      h: 0.3,
      fontSize: 10,
      italic: true,
      color: "9CA3AF",
      fontFace: font,
    });
  }

  // --- Slide 5: Commercial summary ---------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Commercial summary");
    const contingencyPct = Number(p.contingency_pct ?? 0);
    const subtotal = Number(p.subtotal ?? 0);
    const contingencyAmt = subtotal * (contingencyPct / 100);
    const rows: PptxGenJS.TableRow[] = [
      [
        {
          text: "Subtotal",
          options: {
            bold: true,
            fontSize: 14,
            color: "374151",
            fill: { color: "F3F4F6" },
          },
        },
        {
          text: fmtMoney(subtotal, currency),
          options: { fontSize: 14, color: "1F2937", align: "right" },
        },
      ],
      [
        {
          text: `Contingency (${contingencyPct.toFixed(1)}%)`,
          options: {
            bold: true,
            fontSize: 14,
            color: "374151",
            fill: { color: "F3F4F6" },
          },
        },
        {
          text: fmtMoney(contingencyAmt, currency),
          options: { fontSize: 14, color: "1F2937", align: "right" },
        },
      ],
      [
        {
          text: "Total",
          options: {
            bold: true,
            fontSize: 16,
            color: "FFFFFF",
            fill: { color: primary },
          },
        },
        {
          text: fmtMoney(p.total, currency),
          options: {
            bold: true,
            fontSize: 16,
            color: "FFFFFF",
            fill: { color: primary },
            align: "right",
          },
        },
      ],
      [
        {
          text: "Currency",
          options: {
            bold: true,
            fontSize: 14,
            color: "374151",
            fill: { color: "F3F4F6" },
          },
        },
        {
          text: currency,
          options: { fontSize: 14, color: "1F2937", align: "right" },
        },
      ],
      [
        {
          text: "Validity",
          options: {
            bold: true,
            fontSize: 14,
            color: "374151",
            fill: { color: "F3F4F6" },
          },
        },
        {
          text: fmtDate(p.valid_until),
          options: { fontSize: 14, color: "1F2937", align: "right" },
        },
      ],
    ];
    s.addTable(rows, {
      x: 0.7,
      y: 1.2,
      w: 11.9,
      colW: [7.0, 4.9],
      fontFace: font,
      border: { pt: 0.5, color: "E5E7EB" },
      rowH: 0.55,
    });
  }

  // --- Slide 6: Timeline & tender dates ----------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Timeline & tender dates");
    if (data.tenderEvents.length === 0) {
      s.addText("No upcoming tender events", {
        x: 0.7,
        y: 2.0,
        w: 11.9,
        h: 1.0,
        fontSize: 20,
        italic: true,
        color: "9CA3AF",
        align: "center",
        fontFace: font,
      });
    } else {
      const bullets: PptxGenJS.TextProps[] = data.tenderEvents
        .slice(0, 10)
        .flatMap((e) => {
          const head = `${clean(e.event_type).replace(/_/g, " ").toUpperCase()} — ${fmtDate(e.event_at)}`;
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
          const detail = clean(e.title ?? e.notes ?? "");
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
        x: 0.7,
        y: 1.0,
        w: 11.9,
        h: 5.5,
        fontFace: font,
        valign: "top",
      });
    }
  }

  // --- Slide 7: Terms & contact ------------------------------------------
  {
    const s = pptx.addSlide({ masterName: "GM_MASTER" });
    titleBar(s, "Terms & contact");
    const notes = clean(p.notes) ||
      "Standard EPC terms apply. Pricing valid through the date shown below.";
    s.addText(notes, {
      x: 0.7,
      y: 1.0,
      w: 12,
      h: 3.0,
      fontSize: 14,
      color: "1F2937",
      fontFace: font,
      valign: "top",
    });
    s.addText(`Validity: ${fmtDate(p.valid_until)}`, {
      x: 0.7,
      y: 4.1,
      w: 12,
      h: 0.4,
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
        text: clean(owner?.full_name) || "—",
        options: { fontSize: 14, color: "1F2937", breakLine: true },
      },
    ];
    if (owner?.email) {
      contactParts.push({
        text: clean(owner.email),
        options: { fontSize: 14, color: "1F2937" },
      });
    }
    s.addText(contactParts, {
      x: 0.7,
      y: 4.9,
      w: 12,
      h: 1.5,
      fontFace: font,
      valign: "top",
    });
  }

  // Filename ---------------------------------------------------------------
  const filename = `GridMind_Proposal_${slug(opp.account_name)}_${slug(p.title)}_v${p.version ?? 1}.pptx`;

  const out = (await pptx.write({ outputType: "blob" })) as Blob;
  return { blob: out, filename };
}

export { downloadBlob } from "./proposal-pdf";
