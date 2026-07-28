// P-267 — Turnover dossier compiler rules: chapters, gap detection, stamping.
//
// The dossier is generatable early on purpose: gaps are reported, not fatal.
// A "COMPLETE" stamp is earned only when zero gaps remain.
export const DOSSIER_CHAPTER_KEYS = [
  "as_builts",
  "itp_records",
  "test_certificates",
  "om_manuals",
  "warranties",
  "compliance",
  "register_index",
] as const;
export type DossierChapterKey = (typeof DOSSIER_CHAPTER_KEYS)[number];

export interface DossierChapterMeta {
  key: DossierChapterKey;
  /** English business title — the PDF stays English per the export doctrine. */
  title: string;
  required: boolean;
}

export const DOSSIER_CHAPTERS: readonly DossierChapterMeta[] = [
  { key: "as_builts", title: "As-Built Drawings", required: true },
  { key: "itp_records", title: "Inspection & Test Plans", required: true },
  { key: "test_certificates", title: "Test & Commissioning Certificates", required: true },
  { key: "om_manuals", title: "O&M Manuals", required: true },
  { key: "warranties", title: "Warranties", required: true },
  { key: "compliance", title: "Compliance Documents", required: false },
  { key: "register_index", title: "Document Register Index", required: true },
];

export interface DossierItem {
  reference: string;
  title: string;
  revision: string | null;
  status: string | null;
  documentDate: string | null;
  /** Set when the item is present but does not satisfy the chapter's rule. */
  gapReason?: string | null;
}

export interface DossierChapter {
  key: DossierChapterKey;
  title: string;
  required: boolean;
  items: DossierItem[];
}

export interface DossierGap {
  chapter: DossierChapterKey;
  chapterTitle: string;
  count: number;
  detail: string;
}

const chapterMeta = (key: DossierChapterKey): DossierChapterMeta =>
  DOSSIER_CHAPTERS.find((c) => c.key === key)!;

export function emptyChapters(): DossierChapter[] {
  return DOSSIER_CHAPTERS.map((c) => ({ ...c, items: [] }));
}

/**
 * Gaps are of two kinds:
 *  - a required chapter with no items at all
 *  - items carrying a gapReason (ITP without final signoff, drawing not IFC, …)
 */
export function detectGaps(chapters: DossierChapter[]): DossierGap[] {
  const gaps: DossierGap[] = [];
  for (const chapter of chapters ?? []) {
    const meta = chapterMeta(chapter.key) ?? chapter;
    const items = chapter.items ?? [];
    if (meta.required && items.length === 0) {
      gaps.push({
        chapter: chapter.key,
        chapterTitle: meta.title,
        count: 1,
        detail: `${meta.title}: no records in the package`,
      });
      continue;
    }
    const flagged = items.filter((i) => i.gapReason);
    if (flagged.length > 0) {
      const reasons = Array.from(new Set(flagged.map((i) => i.gapReason!)));
      for (const reason of reasons) {
        const count = flagged.filter((i) => i.gapReason === reason).length;
        gaps.push({
          chapter: chapter.key,
          chapterTitle: meta.title,
          count,
          detail: `${count} ${reason}`,
        });
      }
    }
  }
  return gaps;
}

export function gapCount(gaps: DossierGap[]): number {
  return (gaps ?? []).reduce((sum, g) => sum + Math.max(g.count, 0), 0);
}

export function isComplete(chapters: DossierChapter[]): boolean {
  return detectGaps(chapters).length === 0;
}

export function chapterCounts(chapters: DossierChapter[]): Array<{
  key: DossierChapterKey;
  title: string;
  count: number;
  gaps: number;
}> {
  const gaps = detectGaps(chapters);
  return (chapters ?? []).map((c) => ({
    key: c.key,
    title: chapterMeta(c.key)?.title ?? c.title,
    count: (c.items ?? []).length,
    gaps: gapCount(gaps.filter((g) => g.chapter === c.key)),
  }));
}

// Gap reasons produced by the collectors — kept here so the tests and the
// server layer agree on the exact wording that lands on the index page.
export const GAP_REASON = {
  drawingNotIfc: "drawing(s) not IFC-locked",
  itpNoSignoff: "ITP(s) without final signoff",
  certUnsigned: "certificate(s) not signed",
  complianceExpired: "compliance document(s) expired",
} as const;

export const DOSSIER_WRITE_ROLES = new Set([
  "company_admin",
  "project_admin",
  "engineering_admin",
  "construction_admin",
]);

export function canGenerateDossier(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => DOSSIER_WRITE_ROLES.has(r));
}
