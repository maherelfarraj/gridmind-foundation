// Day 4 close-out — typed server errors must reach the toast layer verbatim.
import { describe, expect, it } from "vitest";

import { typedErrorMessage } from "@/lib/typed-error";

const HOLD_POINT = "Open ITP hold point — sign-off required before work proceeds.";
const GEOFENCE = "Location is 2011.3 km from the project site — outside the 5.0 km site geofence.";

describe("typedErrorMessage", () => {
  it("surfaces the hold-point 409 message instead of a generic toast", () => {
    expect(typedErrorMessage(new Error(HOLD_POINT), "Status change failed — reverted")).toBe(
      HOLD_POINT,
    );
  });

  it("surfaces the GPS geofence 422 message", () => {
    expect(typedErrorMessage({ message: GEOFENCE }, "Submit failed")).toBe(GEOFENCE);
  });

  it("reads a nested response body message", () => {
    expect(typedErrorMessage({ body: { message: HOLD_POINT } }, "fallback")).toBe(HOLD_POINT);
  });

  it("falls back for opaque or empty errors", () => {
    expect(typedErrorMessage({}, "Status change failed — reverted")).toBe(
      "Status change failed — reverted",
    );
    expect(typedErrorMessage(new Error("   "), "fallback")).toBe("fallback");
    expect(typedErrorMessage(new Error("[object Response]"), "fallback")).toBe("fallback");
    expect(typedErrorMessage(null, "fallback")).toBe("fallback");
  });

  it("accepts a plain string error", () => {
    expect(typedErrorMessage(HOLD_POINT, "fallback")).toBe(HOLD_POINT);
  });
});
