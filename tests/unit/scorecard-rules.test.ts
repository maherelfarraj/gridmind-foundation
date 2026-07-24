// P-069 — Scorecard rules tests.
import { describe, expect, it } from "vitest";
import {
  computeOtdPct,
  computeQuality,
  computeResponsiveness,
  statusBand,
  trend,
  type ExpeditingInput,
  type GrnInput,
} from "@/lib/scorecard-rules";

const due = { "po-a": "2026-01-10", "po-b": "2026-01-15" };

describe("computeOtdPct", () => {
  it("returns null when no receipts", () => {
    expect(computeOtdPct([], due)).toBeNull();
  });
  it("counts on-time vs late by received_at date", () => {
    const grns: GrnInput[] = [
      { po_id: "po-a", status: "confirmed", defects_count: 0, received_at: "2026-01-09T10:00:00Z" },
      { po_id: "po-a", status: "confirmed", defects_count: 0, received_at: "2026-01-10T23:00:00Z" },
      { po_id: "po-b", status: "confirmed", defects_count: 0, received_at: "2026-01-20T00:00:00Z" },
    ];
    expect(computeOtdPct(grns, due)).toBe(66.67);
  });
  it("ignores GRNs whose PO has no due date", () => {
    const grns: GrnInput[] = [
      { po_id: "orphan", status: "confirmed", defects_count: 0, received_at: "2026-01-09T10:00:00Z" },
    ];
    expect(computeOtdPct(grns, due)).toBeNull();
  });
});

describe("computeQuality", () => {
  it("null when no GRNs", () => {
    expect(computeQuality([])).toBeNull();
  });
  it("100 when all clean", () => {
    expect(
      computeQuality([
        { po_id: "x", status: "confirmed", defects_count: 0, received_at: "2026-01-09" },
      ]),
    ).toBe(100);
  });
  it("counts has_defects and defects_count>0", () => {
    const grns: GrnInput[] = [
      { po_id: "x", status: "confirmed", defects_count: 0, received_at: "2026-01-09" },
      { po_id: "x", status: "has_defects", defects_count: 0, received_at: "2026-01-09" },
      { po_id: "x", status: "confirmed", defects_count: 2, received_at: "2026-01-09" },
      { po_id: "x", status: "confirmed", defects_count: 0, received_at: "2026-01-09" },
    ];
    expect(computeQuality(grns)).toBe(50);
  });
});

describe("computeResponsiveness", () => {
  const now = new Date("2026-01-30T00:00:00Z");
  it("null when no logs", () => {
    expect(computeResponsiveness([], now)).toBeNull();
  });
  it("penalises stale contact and delayed status", () => {
    const logs: ExpeditingInput[] = [
      { status: "on_track", last_vendor_contact_at: "2026-01-25T00:00:00Z" }, // fresh
      { status: "on_track", last_vendor_contact_at: "2026-01-10T00:00:00Z" }, // stale (>14d)
      { status: "delayed", last_vendor_contact_at: "2026-01-29T00:00:00Z" }, // delayed
    ];
    expect(computeResponsiveness(logs, now)).toBe(80);
  });
  it("floors at 0", () => {
    const logs: ExpeditingInput[] = Array.from({ length: 20 }, () => ({
      status: "delayed",
      last_vendor_contact_at: null,
    }));
    expect(computeResponsiveness(logs, now)).toBe(0);
  });
});

describe("trend", () => {
  it("null when either side missing", () => {
    expect(trend(null, 80)).toBeNull();
    expect(trend(80, null)).toBeNull();
  });
  it("computes direction", () => {
    expect(trend(90, 85)!.direction).toBe("up");
    expect(trend(80, 85)!.direction).toBe("down");
    expect(trend(85, 85)!.direction).toBe("flat");
  });
});

describe("statusBand", () => {
  it("respects thresholds", () => {
    expect(statusBand(null)).toBeNull();
    expect(statusBand(95)).toBe("green");
    expect(statusBand(94.99)).toBe("amber");
    expect(statusBand(80)).toBe("amber");
    expect(statusBand(79.99)).toBe("destructive");
  });
});
