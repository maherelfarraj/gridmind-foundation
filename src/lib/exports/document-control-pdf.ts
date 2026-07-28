// P-266 — Document control sheet PDF.
//
// This is the printable artefact the register issues for a registered
// document: identity block, revision/status, holder block when printed as a
// controlled copy, and the control marks (stamp OR uncontrolled watermark).
import {
  createDoc,
  createExportThemeSync,
  contentWidth,
  docBody,
  docH2,
  docTable,
  drawFooters,
  drawHeaderBand,
  fmtDate,
  sanitize,
  slugify,
  PAGE,
  type ExportTheme,
} from "@/lib/exports/theme";
import { applyDocumentControlMarks } from "@/lib/exports/document-control-marks";

export interface DocumentControlSheetInput {
  company: { name: string; legalName: string | null };
  branding: { primaryColor: string | null; accentColor: string | null; logoDataUrl: string | null };
  document: {
    docNumber: string | null;
    title: string;
    docType: string;
    discipline: string | null;
    revision: string;
    status: string;
    retentionClass: string | null;
    changeSummary: string | null;
    projectName?: string | null;
  };
  /** Present only when printing a registered controlled copy. */
  copy?: {
    copyNumber: number;
    holder: string;
    issueDate: string | null;
    location: string | null;
    revisionPinned: string;
  } | null;
  printedAt?: Date;
}

export function buildDocumentControlSheetBytes(input: DocumentControlSheetInput): Uint8Array {
  const printedAt = input.printedAt ?? new Date();
  const theme: ExportTheme = createExportThemeSync(
    {
      primaryColor: input.branding.primaryColor,
      accentColor: input.branding.accentColor,
      logoDataUrl: input.branding.logoDataUrl,
      footerText: sanitize(input.document.docNumber ?? input.document.title),
    },
    { name: input.company.name, legalName: input.company.legalName },
  );

  const doc = createDoc();
  let y = drawHeaderBand(
    doc,
    theme,
    sanitize(input.document.title),
    sanitize(input.document.docNumber ?? ""),
  );

  y = docH2(doc, theme, "Document identity", y + 8);
  y = docTable(doc, theme, {
    startY: y,
    head: [["Field", "Value"]],
    body: [
      ["Document number", sanitize(input.document.docNumber ?? "—")],
      ["Type", sanitize(input.document.docType)],
      ["Discipline", sanitize(input.document.discipline ?? "—")],
      ["Revision", sanitize(input.document.revision)],
      ["Status", sanitize(input.document.status)],
      ["Retention class", sanitize(input.document.retentionClass ?? "—")],
      ["Project", sanitize(input.document.projectName ?? "—")],
      ["Printed", fmtDate(printedAt.toISOString(), "PPpp")],
    ],
  });

  if (input.copy) {
    y = docH2(doc, theme, "Controlled copy record", y + 12);
    y = docTable(doc, theme, {
      startY: y,
      head: [["Field", "Value"]],
      body: [
        ["Copy number", String(input.copy.copyNumber)],
        ["Holder", sanitize(input.copy.holder)],
        ["Location", sanitize(input.copy.location ?? "—")],
        ["Revision pinned", sanitize(input.copy.revisionPinned)],
        ["Issue date", input.copy.issueDate ? fmtDate(input.copy.issueDate) : "—"],
      ],
    });
  }

  if (input.document.changeSummary) {
    y = docH2(doc, theme, "Change summary", y + 12);
    y = docBody(doc, sanitize(input.document.changeSummary), y, contentWidth(doc));
  }

  if (!input.copy) {
    docBody(
      doc,
      "This print is not a registered controlled copy. Verify the current revision in the document register before use.",
      y + 12,
      contentWidth(doc),
    );
  }

  drawFooters(doc, theme);
  applyDocumentControlMarks(doc, {
    controlled: Boolean(input.copy),
    copyNumber: input.copy?.copyNumber,
    holder: input.copy?.holder,
    docNumber: input.document.docNumber,
    revision: input.copy?.revisionPinned ?? input.document.revision,
    printedAt,
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

export function documentControlSheetFilename(input: DocumentControlSheetInput): string {
  const base = slugify(input.document.docNumber ?? input.document.title);
  return input.copy ? `${base}-controlled-copy-${input.copy.copyNumber}.pdf` : `${base}-print.pdf`;
}

export { PAGE };
