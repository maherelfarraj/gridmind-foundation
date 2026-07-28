import { describe, expect, it } from "vitest";

import {
  humanizeAction,
  humanizeEntity,
  relativeTime,
  toActivityItem,
} from "@/lib/dashboard.rules";

describe("dashboard activity humanization", () => {
  it("humanizes namespaced actions", () => {
    expect(humanizeAction("vendor_portal.delivery_proposed")).toBe("Delivery proposed");
    expect(humanizeAction("created")).toBe("Created");
  });

  it("humanizes entity names to singular labels", () => {
    expect(humanizeEntity("purchase_orders")).toBe("Purchase order");
    expect(humanizeEntity("companies")).toBe("Company");
    expect(humanizeEntity("progress")).toBe("Progress");
  });

  it("renders relative time buckets", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(relativeTime("2026-07-28T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-07-28T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-07-28T06:00:00Z", now)).toBe("6h ago");
    expect(relativeTime("2026-07-25T12:00:00Z", now)).toBe("3d ago");
  });

  it("falls back to System when the actor is unknown", () => {
    const item = toActivityItem(
      {
        id: "a1",
        action: "po.approved",
        entity: "purchase_orders",
        entity_id: null,
        created_at: "2026-07-28T11:00:00Z",
        actor_name: null,
      },
      new Date("2026-07-28T12:00:00Z"),
    );
    expect(item).toMatchObject({
      actor: "System",
      action: "Approved",
      entity: "Purchase order",
      when: "1h ago",
    });
  });
});
