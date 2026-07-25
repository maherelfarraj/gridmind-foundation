// P-099 — Handover rules & helpers unit tests.
import { describe, expect, it } from "vitest";

import {
  HANDOVER_PREREQ_KEYS,
  HANDOVER_REASON_LABELS,
  getHandoverBoardInput,
  signCccTransferInput,
} from "@/lib/handover.rules";
import { autoCompleteHandoverChecklist, checkHandoverPrereqs } from "@/lib/handover.server";

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------
describe("handover.rules", () => {
  it("every prereq key has a reason label", () => {
    for (const k of HANDOVER_PREREQ_KEYS) {
      expect(HANDOVER_REASON_LABELS[k]).toMatch(/\S/);
    }
  });

  it("input schemas require a uuid", () => {
    expect(() => getHandoverBoardInput.parse({ projectId: "not-a-uuid" })).toThrow();
    expect(() => signCccTransferInput.parse({ projectId: "still-not" })).toThrow();
    const good = "11111111-1111-1111-1111-111111111111";
    expect(getHandoverBoardInput.parse({ projectId: good }).projectId).toBe(good);
    expect(signCccTransferInput.parse({ projectId: good }).projectId).toBe(good);
  });
});

// ---------------------------------------------------------------------------
// autoCompleteHandoverChecklist
// ---------------------------------------------------------------------------
describe("autoCompleteHandoverChecklist", () => {
  const uid = "user-1";
  const ts = "2026-07-25T00:00:00.000Z";

  it("marks known keys done and preserves unknown items", () => {
    const input = [
      { key: "punch_list_closed", label: "Punch closed", required: true, done: false },
      { key: "custom_note", label: "Extra", required: false, done: false },
    ];
    const out = autoCompleteHandoverChecklist(input, uid, ts);
    const byKey = Object.fromEntries(out.map((i: any) => [i.key, i]));
    expect(byKey.punch_list_closed.done).toBe(true);
    expect(byKey.punch_list_closed.done_by).toBe(uid);
    expect(byKey.ccc_signed.done).toBe(true);
    expect(byKey.turnover_delivered.done).toBe(true);
    expect(byKey.custom_note).toEqual(input[1]);
  });

  it("injects all three items when starting from empty", () => {
    const out = autoCompleteHandoverChecklist([], uid, ts);
    expect(out).toHaveLength(3);
    expect(out.every((i: any) => i.done)).toBe(true);
  });

  it("tolerates a non-array input", () => {
    const out = autoCompleteHandoverChecklist(null, uid, ts);
    expect(out).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// checkHandoverPrereqs — with a fake supabase client
// ---------------------------------------------------------------------------
function makeFakeSupabase(fixtures: {
  codCount: number;
  openACount: number;
  turnoverDelivered: boolean;
  cccStatus: "signed" | "pending_signatures" | null;
}) {
  return {
    from(table: string) {
      const q: any = {
        _table: table,
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          q._head = !!opts?.head;
          return q;
        },
        eq: () => q,
        neq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => {
          if (table === "commissioning_certificates" && q._head) {
            return resolve({ data: null, error: null, count: fixtures.codCount });
          }
          if (table === "qaqc_punch_items" && q._head) {
            return resolve({ data: null, error: null, count: fixtures.openACount });
          }
          if (table === "turnover_packages") {
            return resolve({
              data: fixtures.turnoverDelivered ? [{ status: "delivered" }] : [],
              error: null,
            });
          }
          if (table === "commissioning_certificates" && !q._head) {
            return resolve({
              data: fixtures.cccStatus ? [{ id: "ccc-1", status: fixtures.cccStatus }] : [],
              error: null,
            });
          }
          return resolve({ data: [], error: null, count: 0 });
        },
      };
      return q;
    },
  };
}

describe("checkHandoverPrereqs", () => {
  it("returns all four failures when nothing is done", async () => {
    const sb = makeFakeSupabase({
      codCount: 0,
      openACount: 5,
      turnoverDelivered: false,
      cccStatus: null,
    });
    const res = await checkHandoverPrereqs(sb, "co", "proj");
    expect(res.passes.cod_signed).toBe(false);
    expect(res.passes.no_open_category_a_punch).toBe(false);
    expect(res.passes.turnover_delivered).toBe(false);
    expect(res.passes.ccc_signed).toBe(false);
    expect(res.reasons.map((r) => r.key).sort()).toEqual(
      ["ccc_signed", "cod_signed", "no_open_category_a_punch", "turnover_delivered"].sort(),
    );
  });

  it("returns empty reasons when everything is green", async () => {
    const sb = makeFakeSupabase({
      codCount: 1,
      openACount: 0,
      turnoverDelivered: true,
      cccStatus: "signed",
    });
    const res = await checkHandoverPrereqs(sb, "co", "proj");
    expect(res.reasons).toEqual([]);
    expect(res.cccCertificateId).toBe("ccc-1");
  });

  it("flags only ccc when the CCC is issued but unsigned", async () => {
    const sb = makeFakeSupabase({
      codCount: 1,
      openACount: 0,
      turnoverDelivered: true,
      cccStatus: "pending_signatures",
    });
    const res = await checkHandoverPrereqs(sb, "co", "proj");
    expect(res.reasons.map((r) => r.key)).toEqual(["ccc_signed"]);
    expect(res.cccCertificateId).toBe("ccc-1");
  });
});
