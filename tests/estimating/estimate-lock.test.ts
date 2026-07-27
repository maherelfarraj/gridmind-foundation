// P-214 — Non-draft estimates are locked: every edit path rejects with 409.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assertDraft, assertEstimateWrite } from "@/lib/estimating.server";
import { expectHttpError, makeEstimate, makeWorld } from "./fixtures";

const FUNCTIONS = readFileSync(join(process.cwd(), "src/lib/estimating.functions.ts"), "utf8");

/** The body of an exported server function declaration. */
function handler(name: string): string {
  const start = FUNCTIONS.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = FUNCTIONS.indexOf("\nexport const ", start + 1);
  return FUNCTIONS.slice(start, next === -1 ? undefined : next);
}

const EDIT_FNS = [
  "upsertEstimateLine",
  "deleteEstimateLine",
  "saveEstimateMargins",
  "markEstimatePriced",
] as const;

describe("estimate lock", () => {
  it("rejects edits on an in_review estimate with a typed 409", async () => {
    for (const status of ["in_review", "approved", "priced", "superseded"] as const) {
      const w = makeWorld({ estimates: [makeEstimate({ status })] });
      expect(await expectHttpError(() => assertDraft(w.ctx, "est-1"))).toEqual({
        status: 409,
        code: "estimate_locked",
      });
    }
  });

  it("allows edits while the estimate is still a draft", async () => {
    const w = makeWorld({ estimates: [makeEstimate({ status: "draft" })] });
    await expect(assertDraft(w.ctx, "est-1")).resolves.toMatchObject({ status: "draft" });
  });

  it("routes every edit mutation through the draft guard", () => {
    for (const fn of EDIT_FNS) {
      expect(handler(fn), fn).toContain("assertDraft(context");
      expect(handler(fn), fn).toContain("assertEstimateWrite(context)");
    }
  });

  it("blocks writes for roles without estimate permission", async () => {
    const w = makeWorld({ estimates: [makeEstimate()] }, { roles: ["finance_admin"] });
    expect(await expectHttpError(() => assertEstimateWrite(w.ctx))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });

  it("fails submission with 409 when the approval rule is absent", () => {
    const body = handler("submitEstimateForReview");
    expect(body).toContain("assertDraft(context");
    expect(body).toMatch(/409,\s*"approval_rule_missing"/);
  });

  it("guards conversion: non-approved 409, already-converted 409, no opportunity 422", () => {
    const body = handler("convertEstimateToProposal");
    expect(body).toMatch(/409,\s*"estimate_not_approved"/);
    expect(body).toMatch(/409,\s*"already_converted"/);
    expect(body).toMatch(/422,\s*"opportunity_required"/);
  });
});
