// P-192 — Change-control blocking logic + banner presentation (pure).
import { describe, expect, it } from "vitest";

import {
  bannerState,
  blockingChanges,
  isUnderChangeControl,
  type ChangeControlCr,
  type ThreadLink,
} from "@/lib/moc.change-control";

const COMPANY = "co-a";
const PO_ID = "po-1";

function cr(overrides: Partial<ChangeControlCr> = {}): ChangeControlCr {
  return {
    id: "cr-1",
    cr_number: "CR-0007",
    title: "Swap inverter vendor",
    status: "approved",
    change_type: "vendor_substitution",
    company_id: COMPANY,
    affected_systems: [{ entity_type: "purchase_order", entity_id: PO_ID }],
    ...overrides,
  };
}

const impactLink: ThreadLink = {
  source_type: "change_request",
  source_id: "cr-2",
  link_type: "impacts",
  target_type: "purchase_order",
  target_id: PO_ID,
};

const input = (over: Partial<Parameters<typeof isUnderChangeControl>[0]> = {}) => ({
  viewerCompanyId: COMPANY,
  entityType: "purchase_order",
  entityId: PO_ID,
  changeRequests: [cr()],
  links: [] as ThreadLink[],
  ...over,
});

describe("is_under_change_control — TRUE paths", () => {
  it("is TRUE when an open CR lists the entity in affected_systems", () => {
    expect(isUnderChangeControl(input())).toBe(true);
    for (const status of ["assessment", "approved", "implementing"]) {
      expect(isUnderChangeControl(input({ changeRequests: [cr({ status })] }))).toBe(true);
    }
  });

  it("is TRUE when a CR-sourced impacts link reaches the entity through the thread", () => {
    const result = isUnderChangeControl(
      input({
        changeRequests: [cr({ id: "cr-2", cr_number: "CR-0008", affected_systems: [] })],
        links: [impactLink],
      }),
    );
    expect(result).toBe(true);
  });
});

describe("is_under_change_control — FALSE paths", () => {
  it("is FALSE once the CR is closed, rejected or cancelled", () => {
    for (const status of ["closed", "rejected", "cancelled", "draft"]) {
      expect(isUnderChangeControl(input({ changeRequests: [cr({ status })] }))).toBe(false);
    }
  });

  it("is FALSE for another entity and for another tenant's CR", () => {
    expect(isUnderChangeControl(input({ entityId: "po-other" }))).toBe(false);
    expect(isUnderChangeControl(input({ changeRequests: [cr({ company_id: "co-b" })] }))).toBe(
      false,
    );
    expect(isUnderChangeControl(input({ changeRequests: [] }))).toBe(false);
  });

  it("ignores non-impacts link types", () => {
    expect(
      isUnderChangeControl(
        input({
          changeRequests: [cr({ id: "cr-2", affected_systems: [] })],
          links: [{ ...impactLink, link_type: "derives" }],
        }),
      ),
    ).toBe(false);
  });
});

describe("is_under_change_control — fail closed", () => {
  it("returns TRUE when the caller has no company (unauthenticated)", () => {
    expect(isUnderChangeControl(input({ viewerCompanyId: null, changeRequests: [] }))).toBe(true);
    expect(isUnderChangeControl(input({ viewerCompanyId: undefined }))).toBe(true);
  });
});

describe("blocking CR list", () => {
  it("dedupes a CR that blocks both directly and through the thread", () => {
    const direct = cr({ id: "cr-2", cr_number: "CR-0008" });
    const list = blockingChanges(input({ changeRequests: [direct], links: [impactLink] }));
    expect(list.map((c) => c.id)).toEqual(["cr-2"]);
  });
});

describe("banner presentation", () => {
  it("renders amber with the blocking CR numbers and disables Issue PO", () => {
    const state = bannerState([{ cr_number: "CR-0007", status: "approved" }]);
    expect(state.visible).toBe(true);
    expect(state.toneClass).toBe("bg-accent/15 text-accent");
    expect(state.headline).toBe("Under change control — CR-0007 approved");
    expect(state.crNumbers).toEqual(["CR-0007"]);
    expect(state.issuePoDisabled).toBe(true);
    expect(state.tooltip).toContain("Blocked");
  });

  it("uses semantic tokens only — never a raw colour", () => {
    const state = bannerState([{ cr_number: "CR-0009", status: "implementing" }]);
    expect(state.toneClass).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|\[#/i);
  });

  it("hides itself and re-enables Issue PO when nothing blocks", () => {
    const state = bannerState([]);
    expect(state.visible).toBe(false);
    expect(state.issuePoDisabled).toBe(false);
    expect(state.tooltip).toBeUndefined();
  });
});
