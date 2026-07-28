import { describe, expect, it } from "vitest";

import {
  PO_APPROVAL_DEFAULT_THRESHOLD,
  PO_APPROVAL_ENTITY,
  PO_APPROVAL_RULE_KEY,
  canIssuePo,
  isInstanceOverdue,
  poRequiresApproval,
  poStatusForInstance,
  shouldOpenInstance,
} from "@/lib/po-approval.rules";

describe("PO approval engine rules", () => {
  it("exposes the seeded rule identity", () => {
    expect(PO_APPROVAL_RULE_KEY).toBe("po_threshold_finance");
    expect(PO_APPROVAL_ENTITY).toBe("purchase_order");
    expect(PO_APPROVAL_DEFAULT_THRESHOLD).toBe(50_000);
  });

  it("gates on the dollar threshold", () => {
    expect(poRequiresApproval(107_800, 50_000)).toBe(true);
    expect(poRequiresApproval(50_000, 50_000)).toBe(false);
    expect(poRequiresApproval(7_680, 50_000)).toBe(false);
    expect(poRequiresApproval(1, null)).toBe(true);
  });

  it("drives PO status from the instance", () => {
    expect(poStatusForInstance("pending")).toBe("pending_approval");
    expect(poStatusForInstance("in_progress")).toBe("pending_approval");
    expect(poStatusForInstance("approved")).toBe("approved");
    expect(poStatusForInstance("rejected")).toBe("draft");
    expect(poStatusForInstance("cancelled")).toBeNull();
  });

  it("blocks issuance unless approved", () => {
    expect(canIssuePo("approved")).toBe(true);
    expect(canIssuePo("pending_approval")).toBe(false);
    expect(canIssuePo("draft")).toBe(false);
  });

  it("is idempotent on resubmit while an instance is open", () => {
    expect(shouldOpenInstance(null)).toBe(true);
    expect(shouldOpenInstance({ status: "pending" })).toBe(false);
    expect(shouldOpenInstance({ status: "in_progress" })).toBe(false);
    expect(shouldOpenInstance({ status: "rejected" })).toBe(true);
    expect(shouldOpenInstance({ status: "approved" })).toBe(true);
  });

  it("picks up overdue instances for the escalation sweep", () => {
    const now = new Date("2026-07-27T12:00:00Z");
    expect(isInstanceOverdue({ status: "pending", sla_due_at: "2026-07-26T12:00:00Z" }, now)).toBe(
      true,
    );
    expect(isInstanceOverdue({ status: "pending", sla_due_at: "2026-07-28T12:00:00Z" }, now)).toBe(
      false,
    );
    expect(
      isInstanceOverdue(
        {
          status: "pending",
          sla_due_at: "2026-07-26T12:00:00Z",
          escalated_at: "2026-07-26T13:00:00Z",
        },
        now,
      ),
    ).toBe(false);
    expect(isInstanceOverdue({ status: "approved", sla_due_at: "2026-07-26T12:00:00Z" }, now)).toBe(
      false,
    );
    expect(isInstanceOverdue({ status: "pending", sla_due_at: null }, now)).toBe(false);
  });
});
