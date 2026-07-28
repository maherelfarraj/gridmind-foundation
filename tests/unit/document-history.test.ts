// P-265 — Supersedure chain + revision diff rules.
import { describe, expect, it } from "vitest";

import {
  changedOnly,
  currentNode,
  diffRevisions,
  isHistorical,
  isValidChangeSummary,
  isVisuallyComparable,
  lineageTone,
  orderLineage,
  type LineageNode,
} from "@/lib/documents-history.rules";

function node(over: Partial<LineageNode> & { id: string }): LineageNode {
  return {
    doc_number: "DOC-0001",
    title: "Cable schedule",
    current_revision: "A",
    status: "issued",
    discipline: "electrical",
    change_summary: null,
    supersedes_id: null,
    superseded_by_id: null,
    owner_id: null,
    owner_name: null,
    created_by: null,
    created_by_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    depth: 0,
    is_root: false,
    ...over,
  };
}

// A 3-deep lineage: A → B → C, handed to us out of order.
const a = node({
  id: "a",
  current_revision: "A",
  status: "superseded",
  superseded_by_id: "b",
  depth: 0,
  is_root: true,
  created_at: "2026-01-01T00:00:00Z",
});
const b = node({
  id: "b",
  current_revision: "B",
  status: "superseded",
  supersedes_id: "a",
  superseded_by_id: "c",
  change_summary: "Reissued after cable derating",
  depth: 1,
  created_at: "2026-02-01T00:00:00Z",
});
const c = node({
  id: "c",
  current_revision: "C",
  status: "issued",
  supersedes_id: "b",
  title: "Cable schedule (rev C)",
  change_summary: "Added trench section 4",
  depth: 2,
  created_at: "2026-03-01T00:00:00Z",
});

describe("supersedure chain", () => {
  it("orders a 3-deep lineage oldest → newest", () => {
    expect(orderLineage([c, a, b]).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("resolves the current revision as the node nothing supersedes", () => {
    expect(currentNode([c, a, b])?.id).toBe("c");
  });

  it("marks superseded nodes as historical", () => {
    expect(isHistorical(a)).toBe(true);
    expect(isHistorical(c)).toBe(false);
  });

  it("tones each node by derived state", () => {
    expect(lineageTone(a)).toBe("superseded");
    expect(lineageTone(c)).toBe("current");
    expect(lineageTone(node({ id: "x", status: "obsolete" }))).toBe("obsolete");
    expect(lineageTone(node({ id: "y", status: "draft" }))).toBe("draft");
  });
});

describe("revision comparison", () => {
  it("diffs field-by-field and reports only real changes", () => {
    const changed = changedOnly(diffRevisions(b, c));
    const fields = changed.map((d) => d.field);
    expect(fields).toContain("title");
    expect(fields).toContain("current_revision");
    expect(fields).toContain("status");
    expect(fields).toContain("change_summary");
    expect(fields).not.toContain("discipline");
  });

  it("treats empty strings and nulls as the same value", () => {
    const left = node({ id: "l", discipline: "  " });
    const right = node({ id: "r", discipline: null });
    expect(changedOnly(diffRevisions(left, right))).toEqual([]);
  });

  it("only offers visual compare for rendered file types", () => {
    expect(isVisuallyComparable("application/pdf", "image/png")).toBe(true);
    expect(isVisuallyComparable("application/pdf", "application/dwg")).toBe(false);
    expect(isVisuallyComparable(null, null)).toBe(false);
  });
});

describe("change summary enforcement", () => {
  it("requires a meaningful summary for a new revision", () => {
    expect(isValidChangeSummary(null)).toBe(false);
    expect(isValidChangeSummary("   typo   ")).toBe(false);
    expect(isValidChangeSummary("Added trench section 4")).toBe(true);
  });
});
