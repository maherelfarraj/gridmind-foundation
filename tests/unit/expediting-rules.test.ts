// P-068 — Expediting rules unit tests.
import { describe, expect, it } from "vitest";
import {
  computeLongLeadKpi,
  daysUntilNeed,
  deriveStatus,
  importFromPoSchema,
  updateExpeditingSchema,
} from "@/lib/expediting-rules";

const NOW = new Date("2026-08-01T12:00:00Z");

describe("deriveStatus", () => {
  it("delivered wins over everything else", () => {
    expect(
      deriveStatus(
        {
          current_eta: "2027-01-01",
          site_need_date: "2026-01-01",
          fully_received: true,
        },
        NOW,
      ),
    ).toBe("delivered");
  });

  it("ETA past site-need date is delayed", () => {
    expect(
      deriveStatus(
        {
          current_eta: "2026-09-15",
          site_need_date: "2026-09-01",
          fully_received: false,
        },
        NOW,
      ),
    ).toBe("delayed");
  });

  it("ETA in window with stale (>14d) contact is at_risk", () => {
    // last contact 15 days before NOW
    const stale = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      deriveStatus(
        {
          current_eta: "2026-08-20",
          site_need_date: "2026-09-01",
          delivery_window_start: "2026-08-15",
          delivery_window_end: "2026-08-25",
          last_vendor_contact_at: stale,
          fully_received: false,
        },
        NOW,
      ),
    ).toBe("at_risk");
  });

  it("ETA in window with fresh contact (<14d) is on_track", () => {
    const fresh = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      deriveStatus(
        {
          current_eta: "2026-08-20",
          site_need_date: "2026-09-01",
          delivery_window_start: "2026-08-15",
          delivery_window_end: "2026-08-25",
          last_vendor_contact_at: fresh,
          fully_received: false,
        },
        NOW,
      ),
    ).toBe("on_track");
  });

  it("ETA earlier than site need with no window is on_track", () => {
    expect(
      deriveStatus(
        {
          current_eta: "2026-08-20",
          site_need_date: "2026-09-01",
          fully_received: false,
        },
        NOW,
      ),
    ).toBe("on_track");
  });

  it("delayed check ignores contact staleness", () => {
    const stale = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      deriveStatus(
        {
          current_eta: "2026-10-01",
          site_need_date: "2026-09-01",
          last_vendor_contact_at: stale,
          fully_received: false,
        },
        NOW,
      ),
    ).toBe("delayed");
  });
});

describe("daysUntilNeed", () => {
  it("returns positive for future dates", () => {
    expect(daysUntilNeed("2026-08-11", NOW)).toBe(10);
  });
  it("returns negative for past dates", () => {
    expect(daysUntilNeed("2026-07-22", NOW)).toBe(-10);
  });
  it("returns 0 for today", () => {
    expect(daysUntilNeed("2026-08-01", NOW)).toBe(0);
  });
  it("returns null for invalid input", () => {
    expect(daysUntilNeed(null, NOW)).toBeNull();
  });
});

describe("computeLongLeadKpi", () => {
  it("returns amber empty state when no long-lead items", () => {
    const k = computeLongLeadKpi([]);
    expect(k.total).toBe(0);
    expect(k.band).toBe("amber");
  });

  it("green at exactly 95%", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      is_long_lead: true,
      status: (i < 19 ? "delivered" : "on_track") as any,
      eta_confirmed: false,
    }));
    const k = computeLongLeadKpi(rows);
    expect(k.pct).toBe(95);
    expect(k.band).toBe("green");
  });

  it("amber at 94.something percent", () => {
    // 17 of 18 ready = 94.44%
    const rows = Array.from({ length: 18 }, (_, i) => ({
      is_long_lead: true,
      status: (i < 17 ? "delivered" : "on_track") as any,
      eta_confirmed: false,
    }));
    const k = computeLongLeadKpi(rows);
    expect(k.pct).toBeLessThan(95);
    expect(k.pct).toBeGreaterThanOrEqual(85);
    expect(k.band).toBe("amber");
  });

  it("amber at exactly 85%", () => {
    // 17/20 = 85%
    const rows = Array.from({ length: 20 }, (_, i) => ({
      is_long_lead: true,
      status: (i < 17 ? "delivered" : "on_track") as any,
      eta_confirmed: false,
    }));
    const k = computeLongLeadKpi(rows);
    expect(k.pct).toBe(85);
    expect(k.band).toBe("amber");
  });

  it("destructive below 85%", () => {
    // 16/20 = 80%
    const rows = Array.from({ length: 20 }, (_, i) => ({
      is_long_lead: true,
      status: (i < 16 ? "delivered" : "on_track") as any,
      eta_confirmed: false,
    }));
    const k = computeLongLeadKpi(rows);
    expect(k.band).toBe("destructive");
  });

  it("eta_confirmed counts toward ready", () => {
    const rows = [
      { is_long_lead: true, status: "on_track" as const, eta_confirmed: true },
      { is_long_lead: true, status: "on_track" as const, eta_confirmed: false },
    ];
    const k = computeLongLeadKpi(rows);
    expect(k.ready).toBe(1);
    expect(k.total).toBe(2);
  });

  it("non-long-lead rows are ignored", () => {
    const rows = [
      { is_long_lead: false, status: "delivered" as const, eta_confirmed: true },
      { is_long_lead: true, status: "delivered" as const, eta_confirmed: false },
    ];
    const k = computeLongLeadKpi(rows);
    expect(k.total).toBe(1);
    expect(k.ready).toBe(1);
    expect(k.band).toBe("green");
  });
});

describe("schemas", () => {
  it("importFromPoSchema requires uuid poId", () => {
    expect(() => importFromPoSchema.parse({ poId: "not-a-uuid" })).toThrow();
    expect(
      importFromPoSchema.parse({
        poId: "11111111-1111-1111-1111-111111111111",
      }).longLeadLineNos,
    ).toEqual([]);
  });

  it("updateExpeditingSchema rejects empty patch", () => {
    expect(() =>
      updateExpeditingSchema.parse({
        id: "11111111-1111-1111-1111-111111111111",
        patch: {},
      }),
    ).toThrow();
  });

  it("updateExpeditingSchema accepts single field patch", () => {
    const p = updateExpeditingSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      patch: { eta_confirmed: true },
    });
    expect(p.patch.eta_confirmed).toBe(true);
  });

  it("updateExpeditingSchema validates YYYY-MM-DD date format", () => {
    expect(() =>
      updateExpeditingSchema.parse({
        id: "11111111-1111-1111-1111-111111111111",
        patch: { current_eta: "08/01/2026" },
      }),
    ).toThrow();
  });
});
