// P-096 — Punch closure required-parties rules.
import { describe, expect, it } from "vitest";
import { canCloseNow, missingParties, requiredParties } from "@/lib/commissioning-punch.rules";

describe("commissioning-punch rules", () => {
  it("category A requires contractor + client", () => {
    expect(requiredParties("A", false)).toEqual(["contractor", "client"]);
  });
  it("category A + utility witness requires all three", () => {
    expect(requiredParties("A", true)).toEqual(["contractor", "client", "utility"]);
  });
  it("category B/C require only contractor", () => {
    expect(requiredParties("B", false)).toEqual(["contractor"]);
    expect(requiredParties("C", false)).toEqual(["contractor"]);
  });

  it("missingParties reports what is missing", () => {
    expect(missingParties(["contractor", "client"], ["contractor"])).toEqual(["client"]);
    expect(missingParties(["contractor"], ["contractor"])).toEqual([]);
  });

  it("A cannot close with contractor alone", () => {
    expect(canCloseNow("A", false, ["contractor"])).toBe(false);
  });
  it("A closes with contractor + client", () => {
    expect(canCloseNow("A", false, ["contractor", "client"])).toBe(true);
  });
  it("A + utility waits for all three", () => {
    expect(canCloseNow("A", true, ["contractor", "client"])).toBe(false);
    expect(canCloseNow("A", true, ["contractor", "client", "utility"])).toBe(true);
  });
  it("B closes with contractor alone", () => {
    expect(canCloseNow("B", false, ["contractor"])).toBe(true);
  });
  it("duplicate parties don't change closure decision", () => {
    // set semantics — repeats are irrelevant
    expect(canCloseNow("A", false, ["contractor", "contractor", "client"])).toBe(true);
  });
});
