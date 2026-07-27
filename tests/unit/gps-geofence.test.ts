// Day 4 — GPS geofence guarantee (no fraud).
import { describe, expect, it } from "vitest";

import {
  GEOFENCE_RADIUS_M,
  geofenceRejection,
  gpsRejectionDetail,
  haversineMeters,
} from "@/lib/field-exec.rules";

const SITE = { latitude: 31.9, longitude: 36.1 }; // GSI-EAM-001
const DUBAI = { latitude: 25.2048, longitude: 55.2708 };
const now = Date.parse("2026-07-27T10:00:00.000Z");
const fresh = new Date(now - 60_000).toISOString();

describe("haversineMeters", () => {
  it("computes a known long distance (Amman → Dubai ≈ 2000 km)", () => {
    const d = haversineMeters(SITE.latitude, SITE.longitude, DUBAI.latitude, DUBAI.longitude);
    expect(d).toBeGreaterThan(1_900_000);
    expect(d).toBeLessThan(2_100_000);
  });
  it("is zero for the same point", () => {
    expect(haversineMeters(31.9, 36.1, 31.9, 36.1)).toBe(0);
  });
});

describe("geofenceRejection", () => {
  it("accepts a pin inside the default radius", () => {
    expect(geofenceRejection(31.91, 36.105, SITE)).toBeNull();
  });
  it("rejects Dubai with the typed code and distance", () => {
    const r = geofenceRejection(DUBAI.latitude, DUBAI.longitude, SITE);
    expect(r?.code).toBe("gps_outside_geofence");
    expect(r?.radiusM).toBe(GEOFENCE_RADIUS_M);
    expect(r?.distanceM).toBeGreaterThan(GEOFENCE_RADIUS_M);
    expect(r?.message).toMatch(/outside the/i);
  });
  it("no anchor configured → cannot fence, passes", () => {
    expect(geofenceRejection(DUBAI.latitude, DUBAI.longitude, null)).toBeNull();
  });
  it("honours a project radius override", () => {
    expect(geofenceRejection(32.0, 36.1, { ...SITE, radiusM: 100 })?.code).toBe(
      "gps_outside_geofence",
    );
  });
});

describe("gpsRejectionDetail", () => {
  it("web submissions skip GPS entirely", () => {
    expect(gpsRejectionDetail({ source: "web" }, now, SITE)).toBeNull();
  });
  it("mobile without a fix → gps_required", () => {
    expect(gpsRejectionDetail({ source: "mobile" }, now, SITE)?.code).toBe("gps_required");
  });
  it("stale fix → gps_stale before the fence is even considered", () => {
    const stale = new Date(now - 60 * 60_000).toISOString();
    expect(
      gpsRejectionDetail(
        { source: "mobile", latitude: 31.9, longitude: 36.1, gpsCapturedAt: stale },
        now,
        SITE,
      )?.code,
    ).toBe("gps_stale");
  });
  it("fresh Dubai fix → gps_outside_geofence (422 payload)", () => {
    expect(
      gpsRejectionDetail(
        {
          source: "mobile",
          latitude: DUBAI.latitude,
          longitude: DUBAI.longitude,
          gpsCapturedAt: fresh,
        },
        now,
        SITE,
      )?.code,
    ).toBe("gps_outside_geofence");
  });
  it("fresh on-site fix passes", () => {
    expect(
      gpsRejectionDetail(
        { source: "mobile", latitude: 31.902, longitude: 36.098, gpsCapturedAt: fresh },
        now,
        SITE,
      ),
    ).toBeNull();
  });
});
