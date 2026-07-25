// P-087 — Offline queue behaviour tests: enqueue, sync, retry, dedupe.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the dpr.functions imports before dispatch.ts loads them.
vi.mock("@/lib/dpr.functions", () => ({
  addManpowerRow: vi.fn(),
  addQuantityRow: vi.fn(),
  addWeatherDelay: vi.fn(),
  attachPhoto: vi.fn(),
  createObservation: vi.fn(),
  submitDpr: vi.fn(),
  upsertDprHeader: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

import { __resetDbForTests, listAllMutations } from "@/lib/offline/db";
import {
  clearDispatchersForTests,
  registerDispatcher,
} from "@/lib/offline/dispatch";
import {
  discardMutation,
  enqueueMutation,
  retryMutation,
  syncQueue,
} from "@/lib/offline/queue";

async function resetIdb() {
  await __resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("gridmind-field");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe("offline queue", () => {
  beforeEach(async () => {
    clearDispatchersForTests();
    await resetIdb();
  });
  afterEach(async () => {
    clearDispatchersForTests();
  });

  it("enqueue writes a pending mutation with a uuid key", async () => {
    const key = await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: { dprId: "abc", headcount: 5 },
    });
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const rows = await listAllMutations();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    // Idempotency key was injected into payload for the server fn.
    expect(rows[0].payload.clientIdempotencyKey).toBe(key);
  });

  it("syncQueue marks entries synced on dispatcher success", async () => {
    const spy = vi.fn().mockResolvedValue({ id: "row1" });
    registerDispatcher("dpr", "manpower", spy);
    await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: { headcount: 3 },
    });
    const res = await syncQueue();
    expect(res).toEqual({ attempted: 1, synced: 1, failed: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    const rows = await listAllMutations();
    expect(rows[0].status).toBe("synced");
    expect(rows[0].error).toBeNull();
    expect(rows[0].attempts).toBe(1);
  });

  it("network error keeps the entry pending and bumps attempts", async () => {
    const err = new TypeError("Failed to fetch");
    const spy = vi.fn().mockRejectedValue(err);
    registerDispatcher("dpr", "manpower", spy);
    await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: {},
    });
    const res = await syncQueue();
    expect(res.failed).toBe(0);
    const rows = await listAllMutations();
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].error).toMatch(/fetch/i);
  });

  it("4xx marks the entry failed with the server message", async () => {
    const err = Object.assign(new Error("A DPR already exists"), {
      statusCode: 409,
      body: JSON.stringify({
        error: "duplicate_dpr",
        message: "A DPR already exists",
        existingRoute: "/field/dpr/xyz",
      }),
    });
    registerDispatcher("dpr", "upsert", vi.fn().mockRejectedValue(err));
    await enqueueMutation({
      entity: "dpr",
      action: "upsert",
      payload: { projectId: "p", reportDate: "2026-07-25", shift: "day" },
    });
    const res = await syncQueue();
    expect(res.failed).toBe(1);
    const rows = await listAllMutations();
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("already exists");
    expect(rows[0].existingRoute).toBe("/field/dpr/xyz");
  });

  it("retry re-drains a previously failed entry", async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("boom"), { statusCode: 400, body: "{}" }),
      )
      .mockResolvedValueOnce({ ok: true });
    registerDispatcher("dpr", "manpower", spy);
    const key = await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: {},
    });
    await syncQueue();
    let rows = await listAllMutations();
    expect(rows[0].status).toBe("failed");

    await retryMutation(key);
    rows = await listAllMutations();
    expect(rows[0].status).toBe("synced");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("dedupes: same idempotency key runs the dispatcher once per sync", async () => {
    // Server-side idempotency is proven by the mirror table; the queue
    // guarantees each stored key is only dispatched once, and status becomes
    // 'synced' — a second syncQueue() call is a no-op.
    const spy = vi.fn().mockResolvedValue({ ok: true });
    registerDispatcher("dpr", "manpower", spy);
    const key = await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: {},
    });
    await syncQueue();
    await syncQueue();
    expect(spy).toHaveBeenCalledTimes(1);
    const rows = await listAllMutations();
    expect(rows).toHaveLength(1);
    expect(rows[0].clientIdempotencyKey).toBe(key);
  });

  it("discard removes the mutation from the queue", async () => {
    const key = await enqueueMutation({
      entity: "dpr",
      action: "manpower",
      payload: {},
    });
    await discardMutation(key);
    const rows = await listAllMutations();
    expect(rows).toHaveLength(0);
  });
});
