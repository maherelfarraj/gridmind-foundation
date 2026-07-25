// P-106 — Work orders pure-logic unit tests.
import { describe, expect, it } from "vitest";
import { canTransition, computeTotalCost, workOrderCloseSchema } from "@/lib/work-orders.rules";

describe("computeTotalCost", () => {
  it("sums parts qty*unit_cost + labor hours*rate, rounded to 2dp", () => {
    const total = computeTotalCost(
      [{ description: "fan", qty: 1, unit_cost: 120.5 }],
      [{ hours: 3, rate: 45, date: "2026-07-25" }],
    );
    // 120.50 + 135.00 = 255.50
    expect(total).toBe(255.5);
  });

  it("handles fractional accumulation without float drift", () => {
    const total = computeTotalCost(
      [
        { description: "a", qty: 3, unit_cost: 0.1 },
        { description: "b", qty: 2, unit_cost: 0.2 },
      ],
      [],
    );
    expect(total).toBe(0.7);
  });

  it("returns 0 for empty inputs", () => {
    expect(computeTotalCost([], [])).toBe(0);
  });
});

describe("canTransition", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransition("open", "assigned")).toBe(true);
    expect(canTransition("assigned", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("completed", "closed")).toBe(true);
  });
  it("blocks jumps that skip states", () => {
    expect(canTransition("open", "closed")).toBe(false);
    expect(canTransition("open", "completed")).toBe(false);
  });
  it("terminal states cannot be left", () => {
    expect(canTransition("closed", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "open")).toBe(false);
  });
});

describe("workOrderCloseSchema", () => {
  const id = "00000000-0000-0000-0000-000000000001";
  it("requires resolution_notes always", () => {
    const res = workOrderCloseSchema.safeParse({
      id,
      resolution_notes: "",
      is_corrective: false,
    });
    expect(res.success).toBe(false);
  });
  it("requires failure_cause for corrective WOs", () => {
    const res = workOrderCloseSchema.safeParse({
      id,
      resolution_notes: "Replaced fan, tested.",
      is_corrective: true,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("failure_cause"))).toBe(true);
    }
  });
  it("passes for preventive with just resolution_notes", () => {
    const res = workOrderCloseSchema.safeParse({
      id,
      resolution_notes: "PM completed per checklist.",
      is_corrective: false,
    });
    expect(res.success).toBe(true);
  });
  it("passes for corrective with both fields", () => {
    const res = workOrderCloseSchema.safeParse({
      id,
      resolution_notes: "Replaced cooling fan.",
      failure_cause: "Bearing seized due to dust ingress.",
      is_corrective: true,
    });
    expect(res.success).toBe(true);
  });
});
