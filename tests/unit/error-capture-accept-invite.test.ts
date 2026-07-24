import { describe, expect, it } from "vitest";

import { captureError } from "@/lib/error-capture";

describe("captureError path sanitization", () => {
  it("strips ?token=… from /accept-invite paths", () => {
    const { captured } = captureError(new Error("boom"), {
      path: "/accept-invite?token=deadbeef",
    });
    expect(captured.path).toBe("/accept-invite");
  });

  it("preserves other paths", () => {
    const { captured } = captureError(new Error("boom"), {
      path: "/settings/invites?tab=pending",
    });
    expect(captured.path).toBe("/settings/invites?tab=pending");
  });
});
