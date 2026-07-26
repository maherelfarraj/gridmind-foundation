import { describe, expect, it } from "vitest";

import {
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  backoffSeconds,
  chunkRows,
  isMissingTable,
  nextRetryAt,
  planRetryFailure,
  shouldDeadLetter,
} from "@/lib/scada/retry";

describe("P-177 retry backoff ladder", () => {
  it("follows 1m → 5m → 30m → 2h → 24h", () => {
    expect([...RETRY_BACKOFF_SECONDS]).toEqual([60, 300, 1800, 7200, 86400]);
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(300);
    expect(backoffSeconds(3)).toBe(1800);
    expect(backoffSeconds(4)).toBe(7200);
    expect(backoffSeconds(5)).toBe(86400);
  });

  it("clamps out-of-range attempt counters", () => {
    expect(backoffSeconds(0)).toBe(60);
    expect(backoffSeconds(-3)).toBe(60);
    expect(backoffSeconds(99)).toBe(86400);
  });

  it("computes next_retry_at from a base instant", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    expect(nextRetryAt(1, base)).toBe("2026-01-01T00:01:00.000Z");
    expect(nextRetryAt(3, base)).toBe("2026-01-01T00:30:00.000Z");
  });
});

describe("P-177 dead-letter rule", () => {
  it("dead-letters only at or past max_attempts", () => {
    expect(shouldDeadLetter(4, 5)).toBe(false);
    expect(shouldDeadLetter(5, 5)).toBe(true);
    expect(shouldDeadLetter(6, 5)).toBe(true);
  });

  it("plans a requeue before the budget is spent", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const plan = planRetryFailure(1, MAX_RETRY_ATTEMPTS, base);
    expect(plan).toEqual({
      attempts: 2,
      dead: false,
      next_retry_at: "2026-01-01T00:05:00.000Z",
    });
  });

  it("plans a dead-letter on the final failure", () => {
    const plan = planRetryFailure(4, MAX_RETRY_ATTEMPTS, new Date());
    expect(plan.attempts).toBe(5);
    expect(plan.dead).toBe(true);
    expect(plan.next_retry_at).toBeNull();
  });
});

describe("P-177 helpers", () => {
  it("detects undefined_table for graceful degradation", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "23505" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });

  it("chunks replay rows", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ i }));
    expect(chunkRows(rows, 2).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunkRows([], 2)).toEqual([]);
  });
});
