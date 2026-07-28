// P-266 — Document-control marks for every generated PDF.
//
// Two mutually exclusive marks:
//   • registered controlled copy → header stamp "CONTROLLED COPY No N — holder — date"
//   • anything else              → diagonal "UNCONTROLLED WHEN PRINTED" watermark
//
// Bilingual honesty: jsPDF's built-in fonts carry no Arabic glyphs, so the
// Arabic caption is written into the PDF's document properties (subject +
// keywords) on every page-marked file, and drawn visually only when an
// Arabic-capable font has been registered on the document. Drawing Arabic in
// Helvetica would render as mojibake — a fake bilingual mark is worse than a
// documented limitation.
import type { jsPDF } from "jspdf";

import {
  CONTROLLED_AR,
  UNCONTROLLED_AR,
  UNCONTROLLED_EN,
  controlledStampCaption,
  uncontrolledCaption,
  type StampMeta,
} from "@/lib/controlled-copies.rules";

const ARABIC_FONTS = ["Amiri", "NotoNaskhArabic", "NotoSansArabic", "Cairo"];

function arabicFont(doc: jsPDF): string | null {
  const list = Object.keys(doc.getFontList?.() ?? {});
  return ARABIC_FONTS.find((f) => list.includes(f)) ?? null;
}

function setDocumentProperties(doc: jsPDF, controlled: boolean, caption: string): void {
  const arabic = controlled ? CONTROLLED_AR : UNCONTROLLED_AR;
  doc.setProperties({
    subject: `${caption} | ${arabic}`,
    keywords: [controlled ? "controlled-copy" : "uncontrolled", caption, arabic].join(", "),
  });
}

/** Diagonal watermark across every page, plus a footer caption line. */
export function drawUncontrolledWatermark(doc: jsPDF, meta: StampMeta): void {
  const caption = uncontrolledCaption(meta);
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const ar = arabicFont(doc);

  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    const gs = doc.GState?.({ opacity: 0.12 });
    if (gs) doc.setGState(gs);
    doc.setTextColor(180, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    doc.text(UNCONTROLLED_EN, w / 2, h / 2, { align: "center", angle: 32, baseline: "middle" });
    if (ar) {
      doc.setFont(ar, "normal");
      doc.setFontSize(24);
      doc.text(UNCONTROLLED_AR, w / 2, h / 2 + 34, {
        align: "center",
        angle: 32,
        baseline: "middle",
      });
      doc.setFont("helvetica", "normal");
    }
    const reset = doc.GState?.({ opacity: 1 });
    if (reset) doc.setGState(reset);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 40, 40);
    doc.text(caption, w / 2, h - 14, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }
  setDocumentProperties(doc, false, caption);
}

/** Header stamp identifying a registered controlled copy. */
export function drawControlledCopyStamp(doc: jsPDF, meta: StampMeta): void {
  const caption = controlledStampCaption(meta);
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(20, 90, 60);
    doc.text(caption, w / 2, h - 14, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  }
  setDocumentProperties(doc, true, caption);
}

/** Apply exactly one mark: controlled when a copy number is present. */
export function applyDocumentControlMarks(
  doc: jsPDF,
  meta: StampMeta & { controlled: boolean },
): void {
  if (meta.controlled && meta.copyNumber != null) drawControlledCopyStamp(doc, meta);
  else drawUncontrolledWatermark(doc, meta);
}
