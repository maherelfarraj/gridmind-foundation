import { describe, it, expect } from "vitest";
import {
  computeConnectorKpis,
  connectorConfigSchema,
  createConnectorSchema,
  credentialsRefSchema,
  looksLikeSecret,
} from "@/lib/scada-rules";

describe("credentialsRefSchema", () => {
  it("accepts an env-var style name", () => {
    expect(credentialsRefSchema.parse("SCADA_VENDOR_TOKEN")).toBe("SCADA_VENDOR_TOKEN");
  });

  it("rejects lowercase / mixed case", () => {
    expect(credentialsRefSchema.safeParse("scada_token").success).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(credentialsRefSchema.safeParse("A B").success).toBe(false);
  });

  it("rejects Stripe-style secret", () => {
    expect(credentialsRefSchema.safeParse("sk_live_1234").success).toBe(false);
  });

  it("rejects bearer prefix", () => {
    expect(credentialsRefSchema.safeParse("Bearer abcdefghij").success).toBe(false);
  });

  it("rejects JWT-shaped value", () => {
    const jwtish = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
    expect(credentialsRefSchema.safeParse(jwtish).success).toBe(false);
  });

  it("looksLikeSecret catches long random blobs", () => {
    expect(looksLikeSecret("a".repeat(65))).toBe(true);
  });
});

describe("connectorConfigSchema", () => {
  it("modbus_tcp requires host/port/unit_ids", () => {
    const schema = connectorConfigSchema("modbus_tcp");
    const good = schema.safeParse({
      host: "10.0.0.5",
      port: 502,
      unit_ids: [1, 2],
      poll_interval_s: 5,
    });
    expect(good.success).toBe(true);
  });

  it("strips unknown fields (strict mode)", () => {
    const schema = connectorConfigSchema("vendor_api");
    const parsed = schema.safeParse({
      base_url: "https://x.example.com",
      api_key: "sk_live_leak", // rogue key must be rejected, not silently stored
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createConnectorSchema", () => {
  it("requires a uuid project_id", () => {
    const r = createConnectorSchema.safeParse({
      project_id: "not-a-uuid",
      name: "Inverter A",
      connector_type: "modbus_tcp",
      asset_kind: "inverter",
      config: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("computeConnectorKpis", () => {
  it("reduces rows to active count, total, mapped assets, and max last_seen", () => {
    const kpis = computeConnectorKpis([
      { status: "active", enabled: true, last_seen_at: "2026-07-01T00:00:00Z", assets_count: 3 },
      { status: "disabled", enabled: false, last_seen_at: null, assets_count: 0 },
      { status: "active", enabled: true, last_seen_at: "2026-07-25T12:00:00Z", assets_count: 5 },
    ]);
    expect(kpis.activeCount).toBe(2);
    expect(kpis.totalCount).toBe(3);
    expect(kpis.assetsMapped).toBe(8);
    expect(kpis.lastTelemetryAt).toBe("2026-07-25T12:00:00.000Z");
  });

  it("returns null last_seen when nothing has reported yet", () => {
    expect(computeConnectorKpis([]).lastTelemetryAt).toBeNull();
  });
});
