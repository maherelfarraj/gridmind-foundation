// P-098 — Turnover pack index PDF (branded, client- or server-safe jsPDF).
//
// Ampersands render literally: "O&M" stays "O&M" (no "O&amp;M" and no
// "O&M;" HTML-entity artifact). sanitize() lives in theme.ts.
import {
  contentWidth,
  createDoc,
  createExportThemeSync,
  docH1,
  docH2,
  docTable,
  drawFooters,
  drawHeaderBand,
  ensureSpace,
  fmtDate,
  mm,
  NEUTRAL,
  PAGE,
  sanitize,
} from "@/lib/exports/theme";

// Re-exported for callers/tests that historically imported sanitize from here.
export { sanitize } from "@/lib/exports/theme";

export interface TurnoverPdfSectionItem {
  label: string;
  source: string;
  revision: string | null;
  document_date: string | null;
}

export interface TurnoverPdfSection {
  key: string;
  label: string;
  required: boolean;
  items: TurnoverPdfSectionItem[];
}

export interface TurnoverPdfInput {
  company: { name: string; legalName: string | null };
  project: { name: string; code: string | null };
  branding: {
    primaryColor: string | null;
    accentColor: string | null;
    logoDataUrl: string | null;
  };
  sections: TurnoverPdfSection[];
  compiledAt: string;
}

export function buildTurnoverIndexPdfBytes(input: TurnoverPdfInput): Uint8Array {
  const theme = createExportThemeSync(
    {
      primaryColor: input.branding.primaryColor,
      accentColor: input.branding.accentColor,
      logoDataUrl: input.branding.logoDataUrl,
      footerText: `${input.company.name} • Turnover Package`,
    },
    { name: input.company.name, legal_name: input.company.legalName },
  );

  const doc = createDoc();
  const width = contentWidth(doc);

  const docTitle = "Turnover Package — Index";
  const docSubtitle = `Compiled ${fmtDate(input.compiledAt)}`;
  const pageHeader = { title: docTitle, subtitle: docSubtitle };
  let y = drawHeaderBand(doc, theme, docTitle, docSubtitle);

  y = docH1(doc, sanitize("Turnover Package — Index"), y + mm(2));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(NEUTRAL.body[0], NEUTRAL.body[1], NEUTRAL.body[2]);
  const projectLine = sanitize(
    `Project: ${input.project.name}${input.project.code ? ` (${input.project.code})` : ""}`,
  );
  doc.text(projectLine, PAGE.margin, y);
  y += mm(8);

  for (const section of input.sections) {
    y = ensureSpace(doc, theme, y, mm(24), "Turnover Package — Index");
    y = docH2(doc, theme, section.label, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
    doc.text(sanitize(`${section.items.length} document(s)`), PAGE.margin + width, y - mm(6.5), {
      align: "right",
    });

    if (section.items.length === 0) {
      doc.setTextColor(NEUTRAL.muted[0], NEUTRAL.muted[1], NEUTRAL.muted[2]);
      doc.setFontSize(9.5);
      doc.text(sanitize("— no documents in this section —"), PAGE.margin, y + mm(4));
      y += mm(10);
      continue;
    }

    y = docTable(doc, theme, {
      startY: y,
      pageHeader,
      head: [["Document", "Source", "Revision", "Date"]],
      body: section.items.map((i) => [
        sanitize(i.label),
        sanitize(i.source),
        sanitize(i.revision ?? "—"),
        fmtDate(i.document_date),
      ]),
      columnStyles: {
        0: { cellWidth: width * 0.44 },
        2: { cellWidth: width * 0.16, halign: "center" },
        3: { cellWidth: width * 0.18, halign: "center" },
      },
    });
    y += mm(8);
  }

  drawFooters(doc, theme);

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
