// P-264 — Controlled-document search: pure rules coverage.
import { describe, expect, it } from "vitest";

import {
  cleanFilters,
  groupByType,
  isSearchable,
  normalizeQuery,
  pushRecentSearch,
  RECENT_SEARCHES_MAX,
  snippetSegments,
  type DocSearchHit,
} from "@/lib/documents-search.rules";

function hit(over: Partial<DocSearchHit>): DocSearchHit {
  return {
    id: crypto.randomUUID(),
    doc_number: "DOC-0001",
    title: "Single line diagram",
    doc_type: "drawing",
    discipline: "electrical",
    current_revision: "A",
    status: "issued",
    retention_class: "permanent",
    project_id: null,
    project_name: null,
    file_name: null,
    has_content: false,
    updated_at: "2026-07-01T00:00:00Z",
    rank: 0.1,
    snippet: null,
    ...over,
  };
}

describe("empty-query guard", () => {
  it("rejects blank and one-character queries", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("   ")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable("SL")).toBe(true);
    expect(isSearchable("DOC-0001")).toBe(true);
  });
});

describe("Arabic normalization", () => {
  it("strips tashkeel and unifies alef/ya/ta-marbuta", () => {
    expect(normalizeQuery("الوَثِيقَة")).toBe("الوثيقه");
    expect(normalizeQuery("إنشاء")).toBe("انشاء");
    expect(normalizeQuery("مرمى")).toBe("مرمي");
  });
  it("collapses whitespace", () => {
    expect(normalizeQuery("  single   line  ")).toBe("single line");
  });
});

describe("filter correctness", () => {
  it("collapses all/empty sentinels to null and keeps real values", () => {
    expect(
      cleanFilters({ docType: "all", status: "", discipline: "electrical", projectId: undefined }),
    ).toEqual({
      projectId: null,
      docType: null,
      status: null,
      discipline: "electrical",
      retentionClass: null,
      from: null,
      to: null,
    });
  });
});

describe("ranking order", () => {
  it("orders groups and hits by rank, best first", () => {
    const rows = [
      hit({ doc_type: "itp", rank: 0.2, doc_number: "DOC-0003" }),
      hit({ doc_type: "drawing", rank: 0.9, doc_number: "DOC-0001" }),
      hit({ doc_type: "drawing", rank: 0.4, doc_number: "DOC-0002" }),
    ];
    const groups = groupByType(rows);
    expect(groups.map((g) => g.docType)).toEqual(["drawing", "itp"]);
    expect(groups[0].hits.map((h) => h.doc_number)).toEqual(["DOC-0001", "DOC-0002"]);
  });
  it("buckets untyped documents under other", () => {
    expect(groupByType([hit({ doc_type: null })])[0].docType).toBe("other");
  });
});

describe("snippet generation", () => {
  it("splits ts_headline marks into renderable segments", () => {
    expect(snippetSegments("cable <mark>schedule</mark> rev A")).toEqual([
      { text: "cable ", mark: false },
      { text: "schedule", mark: true },
      { text: " rev A", mark: false },
    ]);
  });
  it("returns nothing for a null snippet", () => {
    expect(snippetSegments(null)).toEqual([]);
  });
});

describe("recent searches", () => {
  it("de-duplicates, normalizes, caps and ignores too-short entries", () => {
    let list: string[] = [];
    list = pushRecentSearch(list, "cable");
    list = pushRecentSearch(list, "  cable ");
    expect(list).toEqual(["cable"]);
    list = pushRecentSearch(list, "a");
    expect(list).toEqual(["cable"]);
    for (let i = 0; i < 12; i++) list = pushRecentSearch(list, `term-${i}`);
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list[0]).toBe("term-11");
  });
});
