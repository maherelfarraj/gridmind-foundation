// P-267 — Turnover dossier PDF: branded cover, gap page, bookmarked chapters.
// English business document per the export doctrine.
import {
  contentWidth,
  createDoc,
  createExportThemeSync,
  docBody,
  docCaption,
  docH1,
  docH2,
  docTable,
  drawFooters,
  drawHeaderBand,
  ensureSpace,
  fmtDate,
  hexToRgb,
  mm,
  NEUTRAL,
  PAGE,
  sanitize,
} from "@/lib/exports/theme";
import {
  chapterCounts,
  detectGaps,
  gapCount,
  type DossierChapter,
} from "@/lib/turnover-dossier.rules";

export interface DossierPdfInput {
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null; targetCod: string | null };
  branding: { primaryColor: string | null; accentColor: string | null; logoDataUrl: string | null };
  chapters: DossierChapter[];
  compiledAt: string;
  docNumber?: string | null;
}

export interface DossierPdfResult {
  bytes: Uint8Array;
  complete: boolean;
  gapTotal: number;
}

export function buildTurnoverDossierPdf(input: DossierPdfInput): DossierPdfResult {
  const gaps = detectGaps(input.chapters);
  const gapTotal = gapCount(gaps);
  const complete = gaps.length === 0;

  const theme = createExportThemeSync(
    {
      primaryColor: input.branding.primaryColor,
      accentColor: input.branding.accentColor,
      logoDataUrl: input.branding.logoDataUrl,
      footerText: `${input.company.name} • Turnover Dossier`,
    },
    { name: input.company.name, legal_name: input.company.legalName },
  );

  const doc = createDoc();
  const width = contentWidth(doc);
  const title = "Turnover Dossier";
  const subtitle = sanitize(
    `${input.project.name}${input.project.code ? ` (${input.project.code})` : ""}`,
  );

  // ------------------------------------------------------------- cover page
  let y = drawHeaderBand(doc, theme, title, subtitle);
  y = docH1(doc, sanitize("Handover Package — Index"), y + mm(2));
  y = docBody(
    doc,
    sanitize(
      `Compiled ${fmtDate(input.compiledAt)} for ${input.company.name}. This dossier is a controlled document; each generated package is registered in the document register under the permanent retention class.`,
    ),
    y + mm(2),
    width,
  );

  y += mm(4);
  y = drawStampBox(doc, theme, y, complete, gapTotal);

  const counts = chapterCounts(input.chapters);
  y = docH2(doc, theme, sanitize("Chapters"), y + mm(6));
  y = docTable(doc, theme, {
    startY: y,
    head: [["#", "Chapter", "Records", "Gaps"]],
    body: counts.map((c, i) => [
      String(i + 1),
      sanitize(c.title),
      String(c.count),
      c.gaps > 0 ? String(c.gaps) : "—",
    ]),
    columnStyles: {
      0: { cellWidth: mm(12) },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  // -------------------------------------------------------------- gap page
  y = ensureSpace(doc, theme, y + mm(8), mm(40), title);
  y = docH2(doc, theme, sanitize("Completeness"), y);
  if (complete) {
    y = docBody(
      doc,
      sanitize("No gaps detected. Every required chapter is populated and every record qualifies."),
      y + mm(2),
      width,
    );
  } else {
    y = docBody(
      doc,
      sanitize(
        `${gapTotal} gap${gapTotal === 1 ? "" : "s"} detected. This dossier was generated with gaps; close the items below before issuing it as the final handover package.`,
      ),
      y + mm(2),
      width,
    );
    y = docTable(doc, theme, {
      startY: y + mm(2),
      head: [["Chapter", "Gap"]],
      body: gaps.map((g) => [sanitize(g.chapterTitle), sanitize(g.detail)]),
    });
  }

  // --------------------------------------------------------- chapter pages
  for (const chapter of input.chapters) {
    doc.addPage();
    let cy = drawHeaderBand(doc, theme, title, subtitle);
    cy = docH1(doc, sanitize(chapter.title), cy + mm(2));
    // Bookmark this chapter so the bundle is navigable.
    addOutlineItem(doc, sanitize(chapter.title));

    const items = chapter.items ?? [];
    if (items.length === 0) {
      cy = docBody(
        doc,
        sanitize(
          chapter.required
            ? "No records — this required chapter is a gap listed on the index page."
            : "No records for this optional chapter.",
        ),
        cy + mm(2),
        width,
      );
      continue;
    }

    cy = docTable(doc, theme, {
      startY: cy + mm(2),
      head: [["Reference", "Title", "Rev", "Status", "Date", "Note"]],
      body: items.map((i) => [
        sanitize(i.reference),
        sanitize(i.title),
        sanitize(i.revision ?? "—"),
        sanitize(i.status ?? "—"),
        i.documentDate ? fmtDate(i.documentDate) : "—",
        sanitize(i.gapReason ?? ""),
      ]),
      columnStyles: {
        2: { cellWidth: mm(14) },
        4: { cellWidth: mm(24) },
      },
    });
    cy = docCaption(doc, sanitize(`${items.length} record(s) in this chapter.`), cy + mm(3));
  }

  drawFooters(doc, theme);
  const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  return { bytes, complete, gapTotal };
}

function drawStampBox(
  doc: ReturnType<typeof createDoc>,
  theme: { primary: [number, number, number]; accent: [number, number, number] },
  y: number,
  complete: boolean,
  gapTotal: number,
): number {
  const width = contentWidth(doc);
  const height = mm(16);
  const color = complete ? theme.accent : hexToRgb("#b45309");
  doc.setDrawColor(...color);
  doc.setFillColor(...(NEUTRAL.white as [number, number, number]));
  doc.setLineWidth(1.2);
  doc.roundedRect(PAGE.margin, y, width, height, 3, 3, "FD");
  doc.setTextColor(...color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(
    complete ? "COMPLETE" : `INCOMPLETE — ${gapTotal} GAP${gapTotal === 1 ? "" : "S"}`,
    PAGE.margin + mm(4),
    y + height / 2 + 4,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...(NEUTRAL.muted as [number, number, number]));
  doc.text(
    complete
      ? "Zero gaps — package qualifies as the final handover dossier."
      : "Generated with gaps — see the completeness section.",
    PAGE.margin + mm(60),
    y + height / 2 + 4,
  );
  doc.setTextColor(...(NEUTRAL.ink as [number, number, number]));
  return y + height;
}

// jsPDF's outline API is namespaced differently across builds; guard it so a
// missing outline never breaks the bundle.
function addOutlineItem(doc: unknown, label: string): void {
  const outline = (
    doc as { outline?: { add?: (parent: null, title: string, opts: object) => void } }
  ).outline;
  const page = (
    doc as { getCurrentPageInfo?: () => { pageNumber: number } }
  ).getCurrentPageInfo?.();
  try {
    outline?.add?.(null, label, { pageNumber: page?.pageNumber ?? 1 });
  } catch {
    /* bookmarks are best-effort */
  }
}
