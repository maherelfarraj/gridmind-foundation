// P-259 — Sub portal (external half): claim math mirrors + the security
// invariants that keep one subcontractor out of another's data.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  claimPayloadLines,
  previewSubClaim,
  remainingPct,
  subCanEditClaim,
  validateClaimLine,
  validateClaimPeriod,
  type SubPortalSovLine,
} from "@/lib/sub-portal.rules";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const SQL = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .sort()
  .map((n) => readFileSync(join(MIGRATIONS, n), "utf8"))
  .join("\n");

function latestFunction(name: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$`,
    "gi",
  );
  const matches = [...SQL.matchAll(re)];
  return matches.length ? matches[matches.length - 1][0].toLowerCase() : "";
}

const line = (over: Partial<SubPortalSovLine> = {}): SubPortalSovLine => ({
  id: "11111111-1111-4111-8111-111111111111",
  line_no: 1,
  description: "Mounting structures",
  uom: "lot",
  qty: 1,
  unit_price: 100_000,
  amount: 100_000,
  certified_pct: 0,
  pending_pct: 0,
  ...over,
});

describe("cumulative 0–100 clamp (client mirror of the derive trigger)", () => {
  it("accepts a period that lands exactly on 100%", () => {
    expect(validateClaimLine(line({ certified_pct: 60 }), 40)).toBeNull();
    expect(remainingPct(line({ certified_pct: 60 }))).toBe(40);
  });

  it("refuses anything that would push cumulative above 100%", () => {
    expect(validateClaimLine(line({ certified_pct: 60 }), 40.01)).toBe(
      "claim_cumulative_out_of_range",
    );
    expect(validateClaimLine(line({ certified_pct: 100 }), 1)).toBe(
      "claim_cumulative_out_of_range",
    );
  });

  it("refuses negative and non-numeric progress", () => {
    expect(validateClaimLine(line(), -1)).toBe("claim_cumulative_out_of_range");
    expect(validateClaimLine(line(), Number.NaN)).toBe("claim_cumulative_out_of_range");
  });
});

describe("claim payload + retention math", () => {
  it("drops zero lines and rounds the percentages it keeps", () => {
    const payload = claimPayloadLines([
      { subcontract_line_id: "a", this_period_pct: 0 },
      { subcontract_line_id: "b", this_period_pct: 12.345 },
    ]);
    expect(payload).toEqual([{ subcontract_line_id: "b", this_period_pct: 12.35 }]);
  });

  it("previews gross, retention and net payable", () => {
    const lines = [line({ id: "l1", amount: 100_000 }), line({ id: "l2", amount: 50_000 })];
    const preview = previewSubClaim(lines, { l1: 25, l2: 10 }, 10);
    expect(preview.thisPeriodAmount).toBe(30_000);
    expect(preview.retentionAmount).toBe(3_000);
    expect(preview.netPayable).toBe(27_000);
  });

  it("validates the claim period", () => {
    expect(validateClaimPeriod("2026-07-01", "2026-07-31")).toBeNull();
    expect(validateClaimPeriod("2026-07-31", "2026-07-01")).toBe("invalid_period");
    expect(validateClaimPeriod("", "2026-07-01")).toBe("invalid_period");
  });
});

describe("cross-sub isolation", () => {
  it("every sub_portal_* routine gates on the caller's own active seat", () => {
    for (const fn of [
      "sub_portal_get_subcontract",
      "sub_portal_get_claim",
      "sub_portal_submit_claim",
      "sub_portal_add_claim_message",
    ]) {
      const def = latestFunction(fn);
      expect(def, fn).not.toBe("");
      expect(def, fn).toContain("sub_portal_has_seat");
      expect(def, fn).toContain("vendor_portal_access_denied");
    }
    const list = latestFunction("sub_portal_list_subcontracts");
    expect(list).toContain("m.user_id = auth.uid()");
    expect(list).toContain("s.vendor_id = p_vendor_id");
    expect(list).toContain("vendor_portal_access_denied");
  });

  it("the subcontract tables are internal-read-only under RLS", () => {
    for (const policy of [
      "subcontracts_select",
      "subcontract_lines_select",
      "subcontract_claims_select",
      "subcontract_claim_lines_select",
    ]) {
      const re = new RegExp(`create policy ${policy}[\\s\\S]*?;`, "i");
      const found = SQL.match(new RegExp(`create policy ${policy}[\\s\\S]*?;`, "gi"));
      expect(found, policy).toBeTruthy();
      const latest = found![found!.length - 1].toLowerCase();
      expect(latest, policy).toContain("is_company_member");
      expect(latest, policy).toContain("not public.is_external_viewer()");
      expect(re.test(SQL)).toBe(true);
    }
  });

  it("internal-only notes never reach the portal payload", () => {
    const def = latestFunction("sub_portal_get_claim");
    expect(def).toContain("m.internal_only = false");
  });
});

describe("seat activation and submission locks", () => {
  it("redeeming a vendor invite activates the portal seat", () => {
    const def = latestFunction("redeem_invite");
    expect(def).toContain("vendor_portal_memberships");
    expect(def).toContain("status = 'active'");
  });

  it("a sub cannot open a second claim while one is in review", () => {
    const def = latestFunction("sub_portal_submit_claim");
    expect(def).toContain("claim_already_open");
    expect(def).toContain("subcontract_not_active");
  });

  it("submission is atomic — the sub never holds an editable claim", () => {
    const def = latestFunction("sub_portal_submit_claim");
    expect(def).toContain("start_approval_instance");
    expect(def).toContain("status = 'submitted'");
    // and there is no sub-facing update/edit routine at all
    expect(SQL.toLowerCase()).not.toContain("function public.sub_portal_update_claim");
    expect(subCanEditClaim("submitted")).toBe(false);
    expect(subCanEditClaim("draft")).toBe(true);
  });

  it("a sub can never self-certify — no sub_portal routine writes 'certified'", () => {
    for (const fn of ["sub_portal_submit_claim", "sub_portal_add_claim_message"]) {
      expect(latestFunction(fn)).not.toContain("'certified'");
    }
  });
});

describe("portal server functions", () => {
  const fns = readFileSync(join(process.cwd(), "src/lib/sub-portal.functions.ts"), "utf8");

  it("gate every sub-facing call on the membership + rate limiter", () => {
    const gates = fns.match(/await vendorGate\(context, data\.vendorId\)/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(6);
  });

  it("never read the subcontract tables directly", () => {
    expect(fns).not.toMatch(/\.from\("subcontract/);
  });
});
