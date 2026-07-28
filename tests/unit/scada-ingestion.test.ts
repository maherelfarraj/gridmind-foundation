import { describe, expect, it } from "vitest";

import {
  applyMappingScaling,
  classifyConnectorHealth,
  isValidMqttTopic,
  isValidOpcUaNodeId,
  matchMqttTopic,
  parseHistorianCsv,
  parseModbusAddress,
  summarizeIngestionHealth,
  tagMappingInputSchema,
  validateSourceAddress,
} from "@/lib/scada/ingestion";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("P-172 protocol addresses", () => {
  it("validates MQTT topics and wildcards", () => {
    expect(isValidMqttTopic("plant/inv-01/ac_power")).toBe(true);
    expect(isValidMqttTopic("plant/+/ac_power")).toBe(true);
    expect(isValidMqttTopic("plant/#")).toBe(true);
    expect(isValidMqttTopic("plant/#/ac")).toBe(false);
    expect(isValidMqttTopic("plant/in+v")).toBe(false);
  });

  it("matches topics against filters", () => {
    expect(matchMqttTopic("plant/+/ac_power", "plant/inv-01/ac_power")).toBe(true);
    expect(matchMqttTopic("plant/+/ac_power", "plant/inv-01/dc_power")).toBe(false);
    expect(matchMqttTopic("plant/#", "plant/inv-01/ac_power")).toBe(true);
    expect(matchMqttTopic("plant/inv-01", "plant/inv-01/ac_power")).toBe(false);
  });

  it("validates OPC UA node ids", () => {
    expect(isValidOpcUaNodeId("ns=2;s=Plant.INV01.ACPower")).toBe(true);
    expect(isValidOpcUaNodeId("ns=0;i=2258")).toBe(true);
    expect(isValidOpcUaNodeId("Plant.INV01")).toBe(false);
  });

  it("parses Modbus addresses", () => {
    expect(parseModbusAddress("1:hr:40071:2")).toEqual({
      unitId: 1,
      area: "holding",
      register: 40071,
      count: 2,
    });
    expect(parseModbusAddress("3:ir:100")).toEqual({
      unitId: 3,
      area: "input",
      register: 100,
      count: 1,
    });
    expect(parseModbusAddress("300:hr:1")).toBeNull();
    expect(parseModbusAddress("1:xx:1")).toBeNull();
  });

  it("reports per-protocol validation errors", () => {
    expect(validateSourceAddress("modbus", "1:hr:40071")).toBeNull();
    expect(validateSourceAddress("modbus", "nope")).toMatch(/unit/i);
    expect(validateSourceAddress("opcua", "bad")).toMatch(/NodeId/);
  });

  it("rejects invalid addresses through the input schema", () => {
    const base = {
      project_id: UUID,
      tag_dictionary_id: UUID,
      protocol: "opcua" as const,
      source_address: "not-a-node",
    };
    expect(tagMappingInputSchema.safeParse(base).success).toBe(false);
    const ok = tagMappingInputSchema.safeParse({ ...base, source_address: "ns=2;i=7" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.poll_interval_s).toBe(60);
  });

  it("applies mapping scaling", () => {
    expect(applyMappingScaling(10, { scaling_factor: 0.1, scaling_offset: -1 })).toBeCloseTo(0, 9);
  });
});

describe("P-172 historian CSV", () => {
  it("parses a wide export into readings", () => {
    const csv = [
      "timestamp,INV01_AC_POWER,INV02_AC_POWER",
      "2026-07-01T00:00:00Z,1200.5,1100",
      "2026-07-01T00:05:00Z,1250,",
    ].join("\n");
    const result = parseHistorianCsv(csv);
    expect(result.rowsReceived).toBe(2);
    expect(result.readings).toHaveLength(3);
    expect(result.readings[0]).toEqual({
      source_column: "INV01_AC_POWER",
      ts: "2026-07-01T00:00:00.000Z",
      value: 1200.5,
    });
    expect(result.errors).toHaveLength(0);
  });

  it("flags bad timestamps and non-numeric cells", () => {
    const csv = ["ts,TAG", "not-a-date,1", "2026-07-01T00:00:00Z,abc"].join("\n");
    const result = parseHistorianCsv(csv);
    expect(result.readings).toHaveLength(0);
    expect(result.errors.map((e) => e.reason)).toEqual(["invalid_timestamp", "invalid_value:TAG"]);
  });

  it("returns an error for header-only input", () => {
    expect(parseHistorianCsv("ts,TAG").errors[0].reason).toBe("no_data_rows");
  });
});

describe("P-172 ingestion health", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const base = {
    connector_id: "c1",
    name: "Inverter MQTT",
    connector_type: "mqtt",
    enabled: true,
    expected_interval_s: 60,
    mappings_count: 4,
  };

  it("marks fresh streams healthy", () => {
    const h = classifyConnectorHealth({ ...base, last_seen_at: "2026-07-01T11:59:30Z" }, now);
    expect(h.health).toBe("healthy");
  });

  it("degrades on lag and staleness", () => {
    expect(
      classifyConnectorHealth({ ...base, last_seen_at: "2026-07-01T11:57:00Z" }, now).health,
    ).toBe("degraded");
    expect(
      classifyConnectorHealth({ ...base, last_seen_at: "2026-07-01T11:50:00Z" }, now).health,
    ).toBe("stale");
  });

  it("marks never-seen and failed runs down, disabled idle", () => {
    expect(classifyConnectorHealth({ ...base, last_seen_at: null }, now).health).toBe("down");
    expect(
      classifyConnectorHealth(
        {
          ...base,
          last_seen_at: "2026-07-01T11:59:30Z",
          lastRun: {
            status: "failed",
            rows_received: 10,
            rows_accepted: 0,
            rows_rejected: 10,
            finished_at: null,
          },
        },
        now,
      ).health,
    ).toBe("down");
    expect(
      classifyConnectorHealth({ ...base, enabled: false, last_seen_at: null }, now).health,
    ).toBe("idle");
  });

  it("degrades on low accept rate", () => {
    const h = classifyConnectorHealth(
      {
        ...base,
        last_seen_at: "2026-07-01T11:59:50Z",
        lastRun: {
          status: "partial",
          rows_received: 100,
          rows_accepted: 80,
          rows_rejected: 20,
          finished_at: null,
        },
      },
      now,
    );
    expect(h.health).toBe("degraded");
    expect(h.acceptRate).toBeCloseTo(0.8, 6);
  });

  it("summarizes KPIs over the last 24h of runs", () => {
    const rows = [
      classifyConnectorHealth({ ...base, last_seen_at: "2026-07-01T11:59:30Z" }, now),
      classifyConnectorHealth({ ...base, connector_id: "c2", last_seen_at: null }, now),
    ];
    const kpis = summarizeIngestionHealth(
      rows,
      [
        { rows_received: 100, rows_accepted: 95, started_at: "2026-07-01T10:00:00Z" },
        { rows_received: 500, rows_accepted: 500, started_at: "2026-06-01T10:00:00Z" },
      ],
      now,
    );
    expect(kpis.connectors).toBe(2);
    expect(kpis.healthy).toBe(1);
    expect(kpis.down).toBe(1);
    expect(kpis.rowsLast24h).toBe(100);
    expect(kpis.acceptRate).toBeCloseTo(0.95, 6);
  });
});
