// P-181 — Field execution pure-logic tests: GPS enforcement, crew rollups,
// equipment utilization and media typing.
import { describe, expect, it } from "vitest";

import {
  crewHeadcountByFront,
  deliveryInput,
  equipmentRecordInput,
  equipmentUtilization,
  gpsRejectionReason,
  materialConsumptionInput,
  mediaTypeForFile,
  workFrontInput,
} from "@/lib/field-exec.rules";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");

describe("gpsRejectionReason", () => {
  it("accepts web submissions without coordinates", () => {
    expect(gpsRejectionReason({ source: "web" }, NOW)).toBeNull();
  });

  it("rejects mobile submissions with no fix", () => {
    expect(gpsRejectionReason({ source: "mobile" }, NOW)).toMatch(/Location required/);
  });

  it("rejects a stale fix older than 15 minutes", () => {
    const reason = gpsRejectionReason(
      {
        source: "mobile",
        latitude: 31.95,
        longitude: 35.93,
        gpsCapturedAt: new Date(NOW - 16 * 60_000).toISOString(),
      },
      NOW,
    );
    expect(reason).toMatch(/stale/);
  });

  it("accepts a fix captured 14 minutes ago", () => {
    expect(
      gpsRejectionReason(
        {
          source: "mobile",
          latitude: 31.95,
          longitude: 35.93,
          gpsCapturedAt: new Date(NOW - 14 * 60_000).toISOString(),
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(
      gpsRejectionReason(
        {
          source: "mobile",
          latitude: 120,
          longitude: 35.93,
          gpsCapturedAt: new Date(NOW).toISOString(),
        },
        NOW,
      ),
    ).toMatch(/Latitude/);
    expect(
      gpsRejectionReason(
        {
          source: "mobile",
          latitude: 31.9,
          longitude: -200,
          gpsCapturedAt: new Date(NOW).toISOString(),
        },
        NOW,
      ),
    ).toMatch(/Longitude/);
  });

  it("rejects an unparseable capture time", () => {
    expect(
      gpsRejectionReason(
        { source: "mobile", latitude: 31.9, longitude: 35.9, gpsCapturedAt: "not-a-date" },
        NOW,
      ),
    ).toMatch(/valid timestamp/);
  });
});

describe("crewHeadcountByFront", () => {
  it("sums headcount per front for the selected date only", () => {
    const rows = [
      { work_front_id: "a", assignment_date: "2026-07-26", headcount: 6 },
      { work_front_id: "a", assignment_date: "2026-07-26", headcount: "4" },
      { work_front_id: "b", assignment_date: "2026-07-26", headcount: 3 },
      { work_front_id: "a", assignment_date: "2026-07-25", headcount: 99 },
    ];
    expect(crewHeadcountByFront(rows, "2026-07-26")).toEqual({ a: 10, b: 3 });
  });
});

describe("equipmentUtilization", () => {
  it("returns 0 with no active units", () => {
    expect(equipmentUtilization([])).toBe(0);
    expect(equipmentUtilization([{ status: "off_hired", hours: 10 }])).toBe(0);
  });

  it("ignores off-hired and broken-down units", () => {
    const util = equipmentUtilization([
      { status: "on_site", hours: 12 },
      { status: "standby", hours: 0 },
      { status: "breakdown", hours: 24 },
    ]);
    expect(util).toBe(25); // 12h / (2 units × 24h)
  });
});

describe("mediaTypeForFile", () => {
  it("classifies video and photo MIME types", () => {
    expect(mediaTypeForFile("video/mp4")).toBe("video");
    expect(mediaTypeForFile("image/jpeg")).toBe("photo");
    expect(mediaTypeForFile(null)).toBe("photo");
  });
});

describe("schemas", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";

  it("rejects equipment hours outside 0–24", () => {
    expect(() =>
      equipmentRecordInput.parse({ dprId: uuid, equipmentTag: "CRN-1", hours: 25 }),
    ).toThrow();
    expect(
      equipmentRecordInput.parse({ dprId: uuid, equipmentTag: "CRN-1", hours: 8 }).status,
    ).toBe("on_site");
  });

  it("rejects non-positive material quantities", () => {
    expect(() =>
      materialConsumptionInput.parse({ dprId: uuid, material: "Cable", qty: 0, uom: "m" }),
    ).toThrow();
  });

  it("defaults new work fronts to active/general", () => {
    const parsed = workFrontInput.parse({ projectId: uuid, name: "Block A" });
    expect(parsed.isActive).toBe(true);
    expect(parsed.discipline).toBe("general");
  });

  it("defaults deliveries to expected", () => {
    expect(deliveryInput.parse({ projectId: uuid }).status).toBe("expected");
  });
});
