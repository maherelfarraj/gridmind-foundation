import { describe, expect, it } from "vitest";

import {
  MAX_EVENT_PAYLOAD_BYTES,
  buildEventRows,
  capEventPayload,
  hookEventsSchema,
  type EventAssetLookup,
} from "@/lib/scada/events";

const assetMap = new Map<string, EventAssetLookup>([
  ["INV-01", { scada_asset_id: "a1", project_id: "p1", asset_node_id: "n1" }],
]);

describe("capEventPayload", () => {
  it("passes small payloads through untouched", () => {
    const res = capEventPayload({ a: 1 });
    expect(res.truncated).toBe(false);
    expect(res.payload).toEqual({ a: 1 });
  });

  it("truncates payloads above 8 KB and flags them", () => {
    const res = capEventPayload({ blob: "x".repeat(MAX_EVENT_PAYLOAD_BYTES + 100) });
    expect(res.truncated).toBe(true);
    expect(res.payload.truncated).toBe(true);
    expect(typeof res.payload.original_bytes).toBe("number");
  });
});

describe("buildEventRows", () => {
  const base = {
    asset_key: "INV-01",
    ts: "2026-01-01T00:00:00.000Z",
    event_type: "trip" as const,
    message: "Inverter trip",
  };

  it("resolves assets to node + project and defaults severity to info", () => {
    const { rows, rejected } = buildEventRows("c1", [base], assetMap);
    expect(rejected).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      company_id: "c1",
      project_id: "p1",
      asset_node_id: "n1",
      scada_asset_id: "a1",
      severity: "info",
      source: "scada",
    });
  });

  it("rejects unknown or cross-tenant asset keys without producing rows", () => {
    const { rows, rejected } = buildEventRows("c1", [{ ...base, asset_key: "OTHER" }], assetMap);
    expect(rows).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("unknown_asset_or_cross_company");
  });

  it("keeps dedupe_key so replays collapse on (project_id, dedupe_key)", () => {
    const { rows } = buildEventRows("c1", [{ ...base, dedupe_key: "vendor-9" }], assetMap);
    expect(rows[0]?.dedupe_key).toBe("vendor-9");
  });
});

describe("hookEventsSchema", () => {
  it("caps a batch at 200 events", () => {
    const many = Array.from({ length: 201 }, () => ({
      asset_key: "INV-01",
      ts: "2026-01-01T00:00:00.000Z",
      event_type: "event",
      message: "m",
    }));
    expect(hookEventsSchema.safeParse(many).success).toBe(false);
  });
});
