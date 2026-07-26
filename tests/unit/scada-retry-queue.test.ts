// P-178 — Retry queue processor: backoff progression, dead-letter move with
// first/final error preserved, and the success path clearing the queue row.
// Offline: the Supabase client is an in-memory double.
import { describe, expect, it } from "vitest";

import { createFakeSupabase } from "../helpers/fake-supabase";
import { processIngestionRetries } from "@/lib/scada-retry.server";
import { MAX_RETRY_ATTEMPTS, RETRY_BACKOFF_SECONDS } from "@/lib/scada/retry";

const NOW = new Date("2026-04-01T12:00:00.000Z");

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    company_id: "co-1",
    project_id: "p1",
    connector_id: null,
    status: "pending",
    payload_kind: "telemetry",
    payload: {
      rows: [{ scada_asset_id: "a1", metric: "power_kw", ts: NOW.toISOString(), value: 10 }],
    },
    error: "first boom",
    attempts: 0,
    max_attempts: MAX_RETRY_ATTEMPTS,
    next_retry_at: "2026-04-01T11:00:00.000Z",
    ...overrides,
  };
}

function client(rows: Record<string, unknown>[], failReplay = false) {
  return createFakeSupabase(
    { ingestion_retry_queue: rows as never, ingestion_dead_letter: [], scada_telemetry: [] },
    failReplay
      ? {
          failOn: (table, op) =>
            table === "scada_telemetry" && op === "upsert" ? "connection reset" : null,
        }
      : {},
  );
}

describe("P-178 retry queue processing", () => {
  it("succeeds and clears the row from the pending queue", async () => {
    const c = client([queueRow()]);
    const summary = await processIngestionRetries(c, NOW);

    expect(summary.processed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.dead_lettered).toBe(0);
    expect(c.db.scada_telemetry).toHaveLength(1);
    // No pending work remains for this row.
    expect(c.db.ingestion_retry_queue.filter((r) => r.status === "pending")).toHaveLength(0);
    expect(c.db.ingestion_retry_queue[0].status).toBe("succeeded");
    expect(c.db.ingestion_dead_letter).toHaveLength(0);
  });

  it("re-queues with the backoff ladder 1m → 5m → 30m → 2h → 24h", async () => {
    for (let attempts = 0; attempts < RETRY_BACKOFF_SECONDS.length - 1; attempts++) {
      const c = client([queueRow({ attempts })], true);
      const summary = await processIngestionRetries(c, NOW);

      expect(summary.requeued).toBe(1);
      const row = c.db.ingestion_retry_queue[0];
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(attempts + 1);
      const expectedAt = new Date(
        NOW.getTime() + RETRY_BACKOFF_SECONDS[attempts] * 1000,
      ).toISOString();
      expect(row.next_retry_at).toBe(expectedAt);
    }
  });

  it("moves to the dead-letter queue at max_attempts, keeping first and final errors", async () => {
    const c = client([queueRow({ attempts: MAX_RETRY_ATTEMPTS - 1, error: "first boom" })], true);
    const summary = await processIngestionRetries(c, NOW);

    expect(summary.dead_lettered).toBe(1);
    expect(summary.requeued).toBe(0);
    expect(c.db.ingestion_retry_queue[0].status).toBe("dead");
    expect(c.db.ingestion_dead_letter).toHaveLength(1);
    const dlq = c.db.ingestion_dead_letter[0];
    expect(dlq.first_error).toBe("first boom");
    expect(dlq.final_error).toBe("connection reset");
    expect(dlq.attempts).toBe(MAX_RETRY_ATTEMPTS);
    expect(dlq.company_id).toBe("co-1");
  });

  it("only picks up rows that are due", async () => {
    const c = client([queueRow({ id: "q-future", next_retry_at: "2026-04-01T13:00:00.000Z" })]);
    const summary = await processIngestionRetries(c, NOW);
    expect(summary.processed).toBe(0);
    expect(c.db.scada_telemetry).toHaveLength(0);
  });

  it("aggregates per-company so the cron writes exactly one audit row per company", async () => {
    const c = client([
      queueRow({ id: "q1", company_id: "co-1" }),
      queueRow({ id: "q2", company_id: "co-1" }),
      queueRow({ id: "q3", company_id: "co-2" }),
    ]);
    const summary = await processIngestionRetries(c, NOW);
    expect(summary.processed).toBe(3);
    expect(summary.perCompany.size).toBe(2);
    expect(summary.perCompany.get("co-1")?.processed).toBe(2);
    expect(summary.perCompany.get("co-2")?.processed).toBe(1);
  });
});
