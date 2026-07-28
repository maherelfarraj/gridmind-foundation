// P-267 — retention math, gap detection, dossier PDF validity, self-registration shape.
import { describe, expect, it } from "vitest";

import {
  classDistribution,
  daysToExpiry,
  distributionTotals,
  isDisposalEligible,
  partitionQueue,
  type DisposalQueueRow,
  type RetentionSummaryRow,
} from "@/lib/document-retention.rules";
import { buildTurnoverDossierPdf } from "@/lib/exports/turnover-dossier-pdf";
import {
  chapterCounts,
  detectGaps,
  emptyChapters,
  gapCount,
  isComplete,
  type DossierChapter,
} from "@/lib/turnover-dossier.rules";

const summary: RetentionSummaryRow[] = [
  { retention_class: "permanent", total: 6, on_hold: 1 },
  { retention_class: "three_years", total: 3, expiring_90d: 2, disposal_eligible: 1 },
  { retention_class: "transient", total: "1", disposal_eligible: "1" },
];

const queueRow = (over: Partial<DisposalQueueRow>): DisposalQueueRow => ({
  id: crypto.randomUUID(),
  doc_number: "DOC-0001",
  title: "Doc",
  doc_type: "drawing",
  status: "issued",
  retention_class: "three_years",
  retention_expires_at: null,
  legal_hold: false,
  project_id: null,
  project_name: null,
  ...over,
});

describe("retention class distribution", () => {
  it("reports every class, including empty ones, with shares summing to 1", () => {
    const rows = classDistribution(summary);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.retentionClass)).toContain("contract_term");
    const share = rows.reduce((s, r) => s + r.share, 0);
    expect(share).toBeCloseTo(1, 6);
  });

  it("coerces string counts and totals across classes", () => {
    const totals = distributionTotals(classDistribution(summary));
    expect(totals.total).toBe(10);
    expect(totals.expiring90d).toBe(2);
    expect(totals.disposalEligible).toBe(2);
    expect(totals.onHold).toBe(1);
  });
});

describe("disposal eligibility", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("never disposes permanent or legally-held documents", () => {
    expect(
      isDisposalEligible(
        queueRow({ retention_class: "permanent", retention_expires_at: "2000-01-01" }),
        now,
      ),
    ).toBe(false);
    expect(
      isDisposalEligible(queueRow({ legal_hold: true, retention_expires_at: "2000-01-01" }), now),
    ).toBe(false);
  });

  it("marks a passed window eligible and partitions the queue", () => {
    const past = queueRow({ retention_expires_at: "2026-01-01" });
    const future = queueRow({ retention_expires_at: "2027-01-01" });
    const held = queueRow({ legal_hold: true, retention_expires_at: "2020-01-01" });
    expect(isDisposalEligible(past, now)).toBe(true);
    expect(daysToExpiry(future, now)).toBeGreaterThan(150);

    const parts = partitionQueue([past, future, held], now);
    expect(parts.eligible).toHaveLength(1);
    expect(parts.maturing).toHaveLength(1);
    expect(parts.held).toHaveLength(1);
  });
});

function chaptersFixture(): DossierChapter[] {
  const chapters = emptyChapters();
  const set = (key: string, items: DossierChapter["items"]) => {
    const c = chapters.find((x) => x.key === key);
    if (c) c.items = items;
  };
  set("as_builts", [
    {
      reference: "DWG-001",
      title: "Site layout",
      revision: "C",
      status: "IFC",
      documentDate: "2026-05-01",
      gapReason: null,
    },
    {
      reference: "DWG-002",
      title: "SLD",
      revision: "B",
      status: "issued",
      documentDate: null,
      gapReason: "Drawing is not IFC-locked",
    },
  ]);
  set("itp_records", [
    {
      reference: "ITP-001",
      title: "Cable pulling",
      revision: "A",
      status: "closed",
      documentDate: "2026-06-01",
      gapReason: null,
    },
  ]);
  set("test_certificates", [
    {
      reference: "CERT-001",
      title: "performance",
      revision: null,
      status: "issued",
      documentDate: "2026-06-10",
      gapReason: null,
    },
  ]);
  set("register_index", [
    {
      reference: "DOC-0001",
      title: "Register",
      revision: "1",
      status: "issued",
      documentDate: "2026-07-01",
      gapReason: null,
    },
  ]);
  return chapters;
}

describe("turnover dossier completeness", () => {
  it("detects item-level and empty-required-chapter gaps", () => {
    const chapters = chaptersFixture();
    const gaps = detectGaps(chapters);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gapCount(gaps)).toBeGreaterThanOrEqual(1);
    expect(isComplete(chapters)).toBe(false);
    // The IFC gap is attributed to the as-builts chapter.
    expect(gaps.some((g) => g.chapter === "as_builts")).toBe(true);
  });

  it("chapter counts mirror record counts and per-chapter gaps", () => {
    const counts = chapterCounts(chaptersFixture());
    const asBuilts = counts.find((c) => c.key === "as_builts");
    expect(asBuilts?.count).toBe(2);
    expect(asBuilts?.gaps).toBeGreaterThanOrEqual(1);
  });
});

describe("turnover dossier PDF", () => {
  const input = {
    company: { name: "GSI", legalName: "Green Solar Industries" },
    project: { name: "East Amman 50 MW", code: "GSI-EAM-001", targetCod: "2027-01-01" },
    branding: { primaryColor: null, accentColor: null, logoDataUrl: null },
    chapters: chaptersFixture(),
    compiledAt: "2026-07-28T10:00:00Z",
  };

  it("produces a valid PDF and reports the gap tally", () => {
    const out = buildTurnoverDossierPdf(input);
    expect(out.bytes.byteLength).toBeGreaterThan(1000);
    const header = String.fromCharCode(...out.bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(out.complete).toBe(false);
    expect(out.gapTotal).toBeGreaterThan(0);
  });

  it("stamps COMPLETE only when zero gaps remain", () => {
    const chapters = emptyChapters().map((c) => ({
      ...c,
      items: [
        {
          reference: "REF",
          title: "Record",
          revision: "A",
          status: "IFC",
          documentDate: "2026-06-01",
          gapReason: null,
        },
      ],
    }));
    const out = buildTurnoverDossierPdf({ ...input, chapters });
    expect(out.complete).toBe(true);
    expect(out.gapTotal).toBe(0);
  });
});
