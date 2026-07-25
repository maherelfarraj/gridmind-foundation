// P-098 — Turnover pack rules & PDF safety
import { describe, expect, it } from "vitest";
import {
  addItemInput,
  allRequiredComplete,
  emptySections,
  markDeliveredInput,
  missingRequiredSections,
  TURNOVER_SECTIONS,
  withComputedCompletion,
} from "@/lib/turnover.rules";
import {
  buildTurnoverIndexPdfBytes,
  sanitize,
} from "@/lib/exports/turnover-index-pdf";

describe("turnover.rules", () => {
  it("empty sections mirror the section catalog and are all incomplete", () => {
    const s = emptySections();
    expect(s.map((x) => x.key)).toEqual(TURNOVER_SECTIONS.map((x) => x.key));
    expect(s.every((x) => x.complete === false)).toBe(true);
    expect(allRequiredComplete(s)).toBe(false);
    expect(missingRequiredSections(s)).toEqual(
      TURNOVER_SECTIONS.map((x) => x.key),
    );
  });

  it("withComputedCompletion flips complete when items exist", () => {
    const s = emptySections();
    s[0].items.push({
      label: "AB-100 rev C",
      file_path: "path/to/file.pdf",
      source: "drawing_register",
      revision: "C",
      document_date: "2026-01-01",
    });
    const c = withComputedCompletion(s);
    expect(c[0].complete).toBe(true);
    expect(allRequiredComplete(c)).toBe(false);
  });

  it("allRequiredComplete needs one item per required section", () => {
    const s = emptySections().map((x) => ({
      ...x,
      items: [
        {
          label: "doc",
          file_path: "p",
          source: "manual",
          revision: null,
          document_date: null,
        },
      ],
    }));
    expect(allRequiredComplete(withComputedCompletion(s))).toBe(true);
  });

  it("addItemInput rejects sections that are not manually uploadable", () => {
    const bad = addItemInput.safeParse({
      projectId: "00000000-0000-0000-0000-000000000001",
      sectionKey: "as_builts",
      items: [
        { label: "x", file_path: "p", source: "manual" },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it("addItemInput accepts om_manual + warranties", () => {
    for (const key of ["om_manual", "warranties"] as const) {
      const ok = addItemInput.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        sectionKey: key,
        items: [{ label: "a", file_path: "p" }],
      });
      expect(ok.success).toBe(true);
    }
  });

  it("markDeliveredInput permits null acceptedBy", () => {
    expect(
      markDeliveredInput.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        acceptedBy: null,
      }).success,
    ).toBe(true);
  });
});

describe("turnover-index-pdf", () => {
  it('sanitize keeps ampersands literal ("O&M" stays "O&M")', () => {
    expect(sanitize("O&M manual")).toBe("O&M manual");
    expect(sanitize("Owner &amp; Operator")).toBe("Owner & Operator");
    // Never the encoded-entity or semicolon-artifact bug.
    expect(sanitize("O&M manual")).not.toBe("O&amp;M manual");
    expect(sanitize("O&M manual")).not.toBe("O&M; manual");
  });

  it("builds a non-empty PDF blob with the O&M section label", () => {
    const bytes = buildTurnoverIndexPdfBytes({
      company: { name: "GridMind EPC", legalName: "GridMind EPC LLC" },
      project: { name: "Sunfield 220 MW", code: "SF-220" },
      branding: {
        primaryColor: "#1e40af",
        accentColor: "#0d9488",
        logoDataUrl: null,
      },
      compiledAt: new Date("2026-07-25T12:00:00Z").toISOString(),
      sections: TURNOVER_SECTIONS.map((s) => ({
        key: s.key,
        label: s.label,
        required: s.required,
        items:
          s.key === "om_manual"
            ? [
                {
                  label: "Plant O&M manual v3",
                  source: "manual",
                  revision: "3",
                  document_date: "2026-06-01",
                },
              ]
            : [],
      })),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const text = new TextDecoder("latin1").decode(bytes);
    // jsPDF encodes strings as (…) content — the ampersand survives literally.
    expect(text.includes("O&M manual")).toBe(true);
    expect(text.includes("O&amp;M")).toBe(false);
  });
});
