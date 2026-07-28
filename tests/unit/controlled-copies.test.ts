// P-266 — Controlled-copy rules + watermark bytes.
import { describe, expect, it } from "vitest";

import {
  UNCONTROLLED_AR,
  UNCONTROLLED_EN,
  controlledStampCaption,
  isRecallDue,
  isRecallOverdue,
  nextCopyNumber,
  parseDocNotCurrent,
  recallCompleteness,
  summariseByHolder,
  uncontrolledCaption,
} from "@/lib/controlled-copies.rules";
import { buildDocumentControlSheetBytes } from "@/lib/exports/document-control-pdf";

const baseDoc = {
  company: { name: "GridMind Solar", legalName: "GridMind Solar Ltd" },
  branding: { primaryColor: null, accentColor: null, logoDataUrl: null },
  document: {
    docNumber: "DOC-0007",
    title: "Single line diagram",
    docType: "drawing",
    discipline: "electrical",
    revision: "B",
    status: "issued",
    retentionClass: "permanent",
    changeSummary: "Breaker rating updated",
  },
  printedAt: new Date("2026-07-28T10:00:00Z"),
};

function pdfText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

describe("copy numbering", () => {
  it("starts at 1 and increments past the highest number", () => {
    expect(nextCopyNumber([])).toBe(1);
    expect(nextCopyNumber([{ copy_number: 1 }, { copy_number: 3 }])).toBe(4);
  });
});

describe("recall completeness", () => {
  const copies = [
    { copy_number: 1, status: "recalled" },
    { copy_number: 2, status: "returned" },
    { copy_number: 3, status: "destroyed" },
    { copy_number: 4, status: "issued", recall_due_at: "2026-07-01T00:00:00Z" },
  ];

  it("counts 3 of 4 recalled and stays incomplete while one is outstanding", () => {
    const s = recallCompleteness(copies);
    expect(s.total).toBe(4);
    expect(s.closed).toBe(3);
    expect(s.outstanding).toBe(1);
    expect(s.recallDue).toBe(1);
    expect(s.ratio).toBe(0.75);
    expect(s.complete).toBe(false);
  });

  it("is complete when no outstanding copy is recall-due", () => {
    const s = recallCompleteness([{ copy_number: 1, status: "issued" }]);
    expect(s.complete).toBe(true);
    expect(s.recallDue).toBe(0);
  });

  it("flags overdue only past the grace period", () => {
    const now = new Date("2026-07-28T00:00:00Z");
    const fresh = { copy_number: 1, status: "issued", recall_due_at: "2026-07-25T00:00:00Z" };
    const old = { copy_number: 2, status: "issued", recall_due_at: "2026-06-01T00:00:00Z" };
    expect(isRecallDue(fresh)).toBe(true);
    expect(isRecallOverdue(fresh, now)).toBe(false);
    expect(isRecallOverdue(old, now)).toBe(true);
  });

  it("rolls up per holder with overdue first", () => {
    const now = new Date("2026-07-28T00:00:00Z");
    const rows = summariseByHolder(
      [
        { copy_number: 1, status: "issued", holder_name: "Site office" },
        {
          copy_number: 2,
          status: "issued",
          holder_name: "QA lead",
          recall_due_at: "2026-06-01T00:00:00Z",
        },
      ],
      now,
    );
    expect(rows[0]).toEqual({ holder: "QA lead", outstanding: 1, due: 1, overdue: 1 });
  });
});

describe("captions and typed 409", () => {
  it("builds the controlled stamp and uncontrolled caption", () => {
    const meta = {
      docNumber: "DOC-0007",
      revision: "B",
      printedAt: new Date("2026-07-28T00:00:00Z"),
      copyNumber: 3,
      holder: "Site office",
    };
    expect(controlledStampCaption(meta)).toBe("CONTROLLED COPY No 3 - Site office - 2026-07-28");
    expect(uncontrolledCaption(meta)).toBe(
      "UNCONTROLLED WHEN PRINTED - DOC-0007 Rev B - 2026-07-28",
    );
  });

  it("parses doc_not_current with the offered current revision", () => {
    const parsed = parseDocNotCurrent({
      message: "doc_not_current",
      details: "0f6d5c2e-1111-4222-8333-444455556666",
    });
    expect(parsed?.code).toBe("doc_not_current");
    expect(parsed?.currentDocumentId).toBe("0f6d5c2e-1111-4222-8333-444455556666");
    expect(parseDocNotCurrent({ message: "other" })).toBeNull();
  });
});

describe("document control sheet PDF", () => {
  it("watermarks a print that is not a registered controlled copy", () => {
    const bytes = buildDocumentControlSheetBytes({ ...baseDoc, copy: null });
    const text = pdfText(bytes);
    expect(text).toContain(UNCONTROLLED_EN);
    // Arabic caption is carried in the document properties (built-in jsPDF
    // fonts have no Arabic glyphs — documented limitation, not faked).
    expect(text).toMatch(/Subject|Keywords/);
    expect(UNCONTROLLED_AR.length).toBeGreaterThan(0);
    expect(text).not.toContain("CONTROLLED COPY No");
  });

  it("stamps a registered controlled copy instead of watermarking it", () => {
    const bytes = buildDocumentControlSheetBytes({
      ...baseDoc,
      copy: {
        copyNumber: 2,
        holder: "Site office",
        issueDate: "2026-07-20",
        location: "Site container A",
        revisionPinned: "B",
      },
    });
    const text = pdfText(bytes);
    expect(text).toContain("CONTROLLED COPY No 2");
    expect(text).not.toContain(UNCONTROLLED_EN);
  });
});
