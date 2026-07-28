// Regression — vendor "Propose delivery" control is wired in the vendor PO UI
// (P-224 gap: RPC existed but no vendor-facing entry point called it).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateProposedDate } from "@/lib/vendor-portal.rules";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const posPage = read("src/routes/vendor.$vendorId.pos.tsx");
const deliveriesPage = read("src/routes/vendor.$vendorId.deliveries.tsx");
const dialog = read("src/components/vendor-portal/propose-delivery-dialog.tsx");
const hook = read("src/lib/vendor-portal-propose.ts");

describe("vendor propose-delivery entry points", () => {
  it("the PO list exposes a Propose delivery action and the shared dialog", () => {
    expect(posPage).toContain("Propose delivery");
    expect(posPage).toContain("ProposeDeliveryDialog");
    expect(posPage).toContain("useProposeDelivery");
  });

  it("the lines drawer shows per-line proposed ETA + confirmation state", () => {
    expect(posPage).toContain("Propose delivery dates");
    expect(posPage).toContain("ConfirmationChip");
    expect(posPage).toContain("Proposed ETA");
  });

  it("the deliveries page reuses the same shared control", () => {
    expect(deliveriesPage).toContain("ProposeDeliveryDialog");
    expect(deliveriesPage).toContain("useProposeDelivery");
  });
});

describe("propose-delivery contract", () => {
  it("submits per-line args through the proposeDelivery server fn", () => {
    expect(hook).toContain("proposeDelivery");
    expect(hook).toMatch(/proposeFn\(\{ data: \{ vendorId, \.\.\.vars \} \}\)/);
    expect(hook).toContain("line_no");
    expect(hook).toContain("proposed_date");
  });

  it("optimistic state is never confirmed and is labelled vendor-proposed", () => {
    expect(hook).toContain("eta_confirmed: false");
    expect(hook).toContain("Vendor-proposed");
    expect(dialog).toContain("portalMod.propose.pendingBuyerConfirmation");
    expect(dialog).not.toContain("eta_confirmed: true");
  });

  it("surfaces typed errors from the RPC", () => {
    expect(hook).toContain("vendorPortalErrorCode");
    expect(hook).toContain("translateError");
  });

  it("client-side guard mirrors the RPC issue-date rule", () => {
    expect(validateProposedDate("2026-09-15", "2026-07-10")).toBeNull();
    expect(validateProposedDate("2026-07-09", "2026-07-10")).toBe("proposed_date_before_issue");
  });
});
