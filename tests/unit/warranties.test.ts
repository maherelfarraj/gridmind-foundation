// P-108 — Unit tests for warranty rules.
import { describe, expect, it } from "vitest";

import {
  canAdvanceClaim,
  checkWarrantyClaimable,
  claimSettleSchema,
  daysRemaining,
  warrantyClaimCreateSchema,
  warrantyContractUpsertSchema,
  warrantyStatusBadge,
} from "@/lib/warranties.rules";

describe("warranty status", () => {
  const today = new Date("2026-07-25T00:00:00Z");

  it("computes days remaining relative to a fixed today", () => {
    expect(daysRemaining("2026-07-25", today)).toBe(0);
    expect(daysRemaining("2026-08-24", today)).toBe(30);
    expect(daysRemaining("2026-07-24", today)).toBe(-1);
  });

  it("badges are active > 90d, expiring 0..90, expired < 0", () => {
    expect(warrantyStatusBadge(200)).toBe("active");
    expect(warrantyStatusBadge(91)).toBe("active");
    expect(warrantyStatusBadge(90)).toBe("expiring");
    expect(warrantyStatusBadge(0)).toBe("expiring");
    expect(warrantyStatusBadge(-1)).toBe("expired");
  });
});

describe("claim override guard", () => {
  const today = new Date("2026-07-25T00:00:00Z");
  const expired = { end_date: "2026-06-01", today };
  const active = { end_date: "2027-01-01", today };

  it("allows claims on active warranties without override", () => {
    expect(checkWarrantyClaimable({ ...active, isOmAdmin: false })).toEqual({ ok: true });
  });
  it("blocks non-admins from claiming on expired warranties", () => {
    expect(checkWarrantyClaimable({ ...expired, isOmAdmin: false })).toEqual({
      ok: false,
      code: "expired_warranty_no_override",
    });
  });
  it("requires an override note from om admins", () => {
    expect(checkWarrantyClaimable({ ...expired, isOmAdmin: true })).toEqual({
      ok: false,
      code: "expired_override_note_required",
    });
    expect(
      checkWarrantyClaimable({ ...expired, isOmAdmin: true, override_note: "vendor confirmed" }),
    ).toEqual({ ok: true });
  });
});

describe("claim state graph", () => {
  it("permits the documented lifecycle", () => {
    expect(canAdvanceClaim("draft", "submitted")).toBe(true);
    expect(canAdvanceClaim("submitted", "under_review")).toBe(true);
    expect(canAdvanceClaim("under_review", "approved")).toBe(true);
    expect(canAdvanceClaim("under_review", "rejected")).toBe(true);
    expect(canAdvanceClaim("approved", "settled")).toBe(true);
    expect(canAdvanceClaim("rejected", "approved")).toBe(false);
    expect(canAdvanceClaim("settled", "approved")).toBe(false);
  });
});

describe("zod schemas", () => {
  it("rejects end_date before start_date", () => {
    expect(() =>
      warrantyContractUpsertSchema.parse({
        project_id: "11111111-1111-1111-1111-111111111111",
        warranty_type: "manufacturer",
        start_date: "2026-07-01",
        end_date: "2026-06-01",
      }),
    ).toThrow();
  });
  it("accepts a well-formed warranty", () => {
    const parsed = warrantyContractUpsertSchema.parse({
      project_id: "11111111-1111-1111-1111-111111111111",
      warranty_type: "manufacturer",
      start_date: "2026-07-01",
      end_date: "2031-07-01",
    });
    expect(parsed.warranty_type).toBe("manufacturer");
  });
  it("requires a non-empty title on claim create", () => {
    expect(() =>
      warrantyClaimCreateSchema.parse({
        warranty_id: "11111111-1111-1111-1111-111111111111",
        title: "",
      }),
    ).toThrow();
  });
  it("requires a non-negative settled amount", () => {
    expect(() =>
      claimSettleSchema.parse({
        id: "11111111-1111-1111-1111-111111111111",
        settled_amount: -1,
      }),
    ).toThrow();
  });
});
