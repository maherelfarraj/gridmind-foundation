import { describe, expect, it } from "vitest";

import {
  WBS_CODE_REGEX,
  isCodeUniqueAmongSiblings,
  suggestNextRootChildCode,
  wbsCreateSchema,
  wouldCreateCycle,
} from "@/lib/wbs-rules";

const nodes = [
  { id: "a", parent_id: null, code: "1" },
  { id: "b", parent_id: "a", code: "1.1" },
  { id: "c", parent_id: "a", code: "1.2" },
  { id: "d", parent_id: "b", code: "1.1.1" },
];

describe("WBS_CODE_REGEX", () => {
  it("accepts standard dotted codes", () => {
    expect(WBS_CODE_REGEX.test("1")).toBe(true);
    expect(WBS_CODE_REGEX.test("1.2")).toBe(true);
    expect(WBS_CODE_REGEX.test("1.2.3.4.5.6")).toBe(true);
    expect(WBS_CODE_REGEX.test("A1.B2")).toBe(true);
  });
  it("rejects bad codes", () => {
    expect(WBS_CODE_REGEX.test("")).toBe(false);
    expect(WBS_CODE_REGEX.test("1.")).toBe(false);
    expect(WBS_CODE_REGEX.test(".1")).toBe(false);
    expect(WBS_CODE_REGEX.test("1..2")).toBe(false);
    expect(WBS_CODE_REGEX.test("1 2")).toBe(false);
  });
});

describe("isCodeUniqueAmongSiblings", () => {
  it("rejects duplicate sibling", () => {
    expect(isCodeUniqueAmongSiblings("1.2", "a", null, nodes)).toBe(false);
  });
  it("allows same code under a different parent", () => {
    expect(isCodeUniqueAmongSiblings("1.2", "b", null, nodes)).toBe(true);
  });
  it("ignores the current node when editing itself", () => {
    expect(isCodeUniqueAmongSiblings("1.1", "a", "b", nodes)).toBe(true);
  });
});

describe("wouldCreateCycle", () => {
  it("blocks self-parenting", () => {
    expect(wouldCreateCycle(nodes, "a", "a")).toBe(true);
  });
  it("blocks moving a node under its descendant", () => {
    expect(wouldCreateCycle(nodes, "a", "d")).toBe(true);
  });
  it("allows moving under an unrelated node", () => {
    expect(wouldCreateCycle(nodes, "b", "c")).toBe(false);
  });
  it("allows detaching to root", () => {
    expect(wouldCreateCycle(nodes, "b", null)).toBe(false);
  });
});

describe("suggestNextRootChildCode", () => {
  it("finds the lowest free integer suffix", () => {
    expect(suggestNextRootChildCode("1", nodes)).toBe("1.3");
  });
  it("starts at 1 with no siblings", () => {
    expect(suggestNextRootChildCode("2", nodes)).toBe("2.1");
  });
});

describe("wbsCreateSchema", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    code: "1",
    name: "Engineering",
    item_type: "phase" as const,
  };
  it("accepts a minimal root node", () => {
    expect(wbsCreateSchema.safeParse(base).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(wbsCreateSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });
  it("rejects invalid discipline", () => {
    expect(wbsCreateSchema.safeParse({ ...base, discipline: "plumbing" as any }).success).toBe(
      false,
    );
  });
  it("rejects negative budget", () => {
    expect(wbsCreateSchema.safeParse({ ...base, budgeted_amount: -1 }).success).toBe(false);
  });
  it("rejects invalid code", () => {
    expect(wbsCreateSchema.safeParse({ ...base, code: "1..2" }).success).toBe(false);
  });
});
