import { describe, expect, it } from "vitest";

import { externalLandingFor, isExternalOnly } from "@/lib/portal-landing";

describe("external viewer shell routing", () => {
  it("routes vendor_viewer to the vendor portal", () => {
    expect(externalLandingFor(["vendor_viewer"])).toBe("/vendor");
  });

  it("routes client/investor/lender viewers to the client portal", () => {
    for (const r of ["client_viewer", "investor_viewer", "lender_viewer"]) {
      expect(externalLandingFor([r])).toBe("/portal");
    }
  });

  it("leaves internal users on the internal shell", () => {
    expect(externalLandingFor(["engineer"])).toBeNull();
    expect(externalLandingFor(["company_admin", "client_viewer"])).toBeNull();
    expect(externalLandingFor([])).toBeNull();
  });

  it("isExternalOnly matches is_external_viewer semantics", () => {
    expect(isExternalOnly(["vendor_viewer", "client_viewer"])).toBe(true);
    expect(isExternalOnly(["vendor_viewer", "finance_admin"])).toBe(false);
  });
});
