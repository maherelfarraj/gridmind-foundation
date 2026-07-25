// P-086 — Unit tests for DPR pure helpers.
import { describe, expect, it } from "vitest";

import {
  canApproveDpr,
  canEditDpr,
  normalizeDiscipline,
  photoObjectPath,
  submitBlockedReason,
  sumManpower,
} from "@/lib/dpr.rules";

describe("sumManpower", () => {
  it("sums headcount and headcount×hours", () => {
    expect(
      sumManpower([
        { headcount: 12, hours: 8 },
        { headcount: 8, hours: 10 },
        { headcount: 2, hours: 6 },
      ]),
    ).toEqual({ totalManpower: 22, totalHours: 188 });
  });

  it("handles empty rows", () => {
    expect(sumManpower([])).toEqual({ totalManpower: 0, totalHours: 0 });
  });

  it("coerces string hours", () => {
    expect(sumManpower([{ headcount: 3, hours: "7.5" as any }])).toEqual({
      totalManpower: 3,
      totalHours: 22.5,
    });
  });
});

describe("canEditDpr", () => {
  it("permits creator on draft", () => {
    expect(canEditDpr("draft", [], true)).toBe(true);
  });
  it("permits foreman even when not creator", () => {
    expect(canEditDpr("draft", ["foreman"], false)).toBe(true);
  });
  it("blocks after submit even for creator", () => {
    expect(canEditDpr("submitted", ["foreman"], true)).toBe(false);
  });
  it("blocks non-privileged non-creators", () => {
    expect(canEditDpr("draft", ["field_technician"], false)).toBe(false);
  });
});

describe("canApproveDpr", () => {
  it("permits construction_admin", () => {
    expect(canApproveDpr(["construction_admin"])).toBe(true);
  });
  it("permits company_admin", () => {
    expect(canApproveDpr(["company_admin"])).toBe(true);
  });
  it("denies foreman", () => {
    expect(canApproveDpr(["foreman"])).toBe(false);
  });
});

describe("normalizeDiscipline", () => {
  it.each([
    ["Civil works", "civil"],
    ["Structural / mech", "mechanical"],
    ["Electrical DC", "electrical"],
    ["Module install", "electrical"],
    ["misc", "other"],
    [null, "other"],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeDiscipline(input as any)).toBe(expected);
  });
});

describe("photoObjectPath", () => {
  it("places company UUID first for storage policy", () => {
    const path = photoObjectPath(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "2026-07-25",
      "IMG_0001.jpg",
    );
    expect(path.startsWith("11111111-1111-1111-1111-111111111111/")).toBe(true);
    expect(path).toContain("/22222222-2222-2222-2222-222222222222/");
    expect(path).toContain("/field/2026-07-25/");
    expect(path.endsWith("-IMG_0001.jpg")).toBe(true);
  });

  it("sanitizes unsafe filename characters", () => {
    const path = photoObjectPath("c", "p", "2026-07-25", "../weird name!.png");
    expect(path).not.toContain("..");
    expect(path).not.toContain(" ");
  });
});

describe("submitBlockedReason", () => {
  it("requires manpower rows", () => {
    expect(
      submitBlockedReason({ manpowerCount: 0, photoCount: 3, acknowledgeNoPhotos: false }),
    ).toBe("manpower_required");
  });
  it("requires ack when zero photos", () => {
    expect(
      submitBlockedReason({ manpowerCount: 3, photoCount: 0, acknowledgeNoPhotos: false }),
    ).toBe("photos_required_ack");
  });
  it("passes with photos", () => {
    expect(
      submitBlockedReason({ manpowerCount: 3, photoCount: 1, acknowledgeNoPhotos: false }),
    ).toBeNull();
  });
  it("passes with ack + no photos", () => {
    expect(
      submitBlockedReason({ manpowerCount: 3, photoCount: 0, acknowledgeNoPhotos: true }),
    ).toBeNull();
  });
});
