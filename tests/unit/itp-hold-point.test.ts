import { describe, expect, it, vi } from "vitest";
import { assertNoOpenHoldPoint } from "@/lib/quality.server";
import { HOLD_POINT_MESSAGE, openHoldPoints } from "@/lib/quality.rules";

type Rpc = ReturnType<typeof vi.fn>;

function mockClient(rpc: Rpc, update: Rpc) {
  return {
    rpc,
    from: () => ({
      update: (patch: unknown) => {
        update(patch);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }),
        };
      },
    }),
  } as never;
}

/** Mirrors the P-183 order of operations in updateCwp: guard, then update. */
async function advanceCwp(client: never, updateSpy: Rpc) {
  await assertNoOpenHoldPoint(client, "cwp-1");
  const c = client as unknown as { from: (t: string) => { update: (p: unknown) => unknown } };
  c.from("construction_work_packages").update({ progress_pct: 60 });
  updateSpy;
}

describe("P-186 · ITP hold-point gate", () => {
  it("guard resolves → the CWP progress mutation proceeds", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const update = vi.fn();
    const client = mockClient(rpc, update);
    await expect(advanceCwp(client, update)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("assert_no_open_hold_point", { p_cwp_id: "cwp-1" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it("guard raises P0001 → 409 with the operator message and no update issued", async () => {
    const rpc = vi.fn(async () => ({
      error: { code: "P0001", message: "open_hold_point: ITP-0001 step 3 unsigned" },
    }));
    const update = vi.fn();
    const client = mockClient(rpc, update);

    let thrown: unknown;
    try {
      await advanceCwp(client, update);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { statusCode?: number };
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe(HOLD_POINT_MESSAGE);
    expect(HOLD_POINT_MESSAGE).toBe(
      "Open ITP hold point — sign-off required before work proceeds.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("no cwp id → guard short-circuits without calling the RPC", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await assertNoOpenHoldPoint(mockClient(rpc, vi.fn()), null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SQL predicate fixture: pending/failed hold points block, signed_off/waived pass", () => {
    const steps = [
      { point_type: "hold", status: "pending" },
      { point_type: "hold", status: "failed" },
      { point_type: "hold", status: "signed_off" },
      { point_type: "hold", status: "waived" },
      { point_type: "witness", status: "pending" },
    ];
    const open = openHoldPoints(steps);
    expect(open.map((s) => s.status).sort()).toEqual(["failed", "pending"]);
    expect(openHoldPoints(steps.filter((s) => s.status === "signed_off"))).toHaveLength(0);
    expect(openHoldPoints(steps.filter((s) => s.status === "waived"))).toHaveLength(0);
  });
});
