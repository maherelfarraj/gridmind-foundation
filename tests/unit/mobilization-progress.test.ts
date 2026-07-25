import { describe, expect, it } from "vitest";
import {
  computeProgress,
  defaultSeedItems,
  deriveChecklistStatus,
  type ChecklistItem,
} from "@/lib/mobilization.rules";

function makeItem(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    key: overrides.key ?? "k",
    label: overrides.label ?? "l",
    category: overrides.category ?? "cabins_facilities",
    required: overrides.required ?? true,
    status: overrides.status ?? "not_started",
    evidence_path: overrides.evidence_path ?? null,
    completed_by: overrides.completed_by ?? null,
    completed_at: overrides.completed_at ?? null,
    notes: overrides.notes ?? null,
    roster: overrides.roster,
  };
}

describe("mobilization progress helpers", () => {
  it("seeds items across all six categories including HSE roster", () => {
    const items = defaultSeedItems();
    const cats = new Set(items.map((i) => i.category));
    expect(cats.size).toBe(6);
    const hse = items.find((i) => i.category === "hse_induction");
    expect(hse).toBeDefined();
    expect(Array.isArray(hse!.roster)).toBe(true);
  });

  it("computeProgress counts required-only completion", () => {
    const items: ChecklistItem[] = [
      makeItem({ key: "a", required: true, status: "complete" }),
      makeItem({ key: "b", required: true, status: "not_started" }),
      makeItem({ key: "c", required: false, status: "complete" }),
    ];
    const p = computeProgress(items);
    expect(p.requiredComplete).toBe(1);
    expect(p.requiredTotal).toBe(2);
    expect(p.totalComplete).toBe(2);
    expect(p.total).toBe(3);
    expect(p.allRequiredDone).toBe(false);
  });

  it("computeProgress reports allRequiredDone only when every required item is complete", () => {
    const items: ChecklistItem[] = [
      makeItem({ key: "a", required: true, status: "complete" }),
      makeItem({ key: "b", required: true, status: "complete" }),
      makeItem({ key: "c", required: false, status: "not_started" }),
    ];
    const p = computeProgress(items);
    expect(p.allRequiredDone).toBe(true);
  });

  it("deriveChecklistStatus never returns 'complete' — that transition is explicit only", () => {
    const items: ChecklistItem[] = [
      makeItem({ key: "a", required: true, status: "complete" }),
      makeItem({ key: "b", required: true, status: "complete" }),
    ];
    expect(deriveChecklistStatus(items)).toBe("in_progress");
  });

  it("deriveChecklistStatus returns 'not_started' when nothing touched", () => {
    expect(deriveChecklistStatus(defaultSeedItems())).toBe("not_started");
  });
});
