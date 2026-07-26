import { describe, expect, it } from "vitest";

import {
  applyIssuance,
  availableQty,
  canTransitionShipment,
  formatMaterialNumber,
  nextMaterialSequence,
  requiresCustomsStatus,
  shortageFor,
  shouldSeedRtv,
} from "@/lib/materials.rules";

describe("materials numbering", () => {
  it("pads sequences per prefix", () => {
    expect(formatMaterialNumber("RES", 7)).toBe("RES-0007");
    expect(formatMaterialNumber("MTO", 1234)).toBe("MTO-1234");
  });

  it("continues from the highest issued number of the same prefix", () => {
    expect(nextMaterialSequence("RES", ["RES-0001", "RES-0009", "ISS-0100"])).toBe(10);
    expect(nextMaterialSequence("DN", [])).toBe(1);
  });
});

describe("availability and shortages", () => {
  it("available is on hand minus reserved, floored at zero", () => {
    expect(availableQty({ qty_on_hand: 100, qty_reserved: 40 })).toBe(60);
    expect(availableQty({ qty_on_hand: 10, qty_reserved: 10 })).toBe(0);
  });

  it("raises a shortage only when demand exceeds availability", () => {
    expect(shortageFor(25, 10)).toBe(15);
    expect(shortageFor(10, 10)).toBe(0);
  });
});

describe("issuance against a reservation", () => {
  it("decrements reserved and on hand together and keeps the reservation active", () => {
    const r = applyIssuance({
      qtyOnHand: 100,
      qtyReserved: 30,
      reservationQty: 30,
      alreadyIssued: 0,
      issueQty: 10,
    });
    expect(r).toMatchObject({ qtyOnHand: 90, qtyReserved: 20, reservationStatus: "active" });
  });

  it("fulfils the reservation only when fully issued", () => {
    const r = applyIssuance({
      qtyOnHand: 90,
      qtyReserved: 20,
      reservationQty: 30,
      alreadyIssued: 10,
      issueQty: 20,
    });
    expect(r.reservationStatus).toBe("fulfilled");
    expect(r.qtyReserved).toBe(0);
  });

  it("rejects issuing more than the reserved balance", () => {
    expect(() =>
      applyIssuance({
        qtyOnHand: 100,
        qtyReserved: 5,
        reservationQty: 5,
        alreadyIssued: 0,
        issueQty: 6,
      }),
    ).toThrow(/exceeds the reserved balance/);
  });
});

describe("shipment lifecycle", () => {
  it("covers factory release, customs hold, clearance and delivery", () => {
    expect(canTransitionShipment("preparing", "factory_release")).toBe(true);
    expect(canTransitionShipment("factory_release", "in_transit")).toBe(true);
    expect(canTransitionShipment("in_transit", "customs_hold")).toBe(true);
    expect(canTransitionShipment("customs_hold", "customs_cleared")).toBe(true);
    expect(canTransitionShipment("customs_cleared", "delivered")).toBe(true);
  });

  it("blocks backwards and terminal transitions", () => {
    expect(canTransitionShipment("delivered", "in_transit")).toBe(false);
    expect(canTransitionShipment("preparing", "delivered")).toBe(false);
  });

  it("requires a customs status in customs states", () => {
    expect(requiresCustomsStatus("customs_hold")).toBe(true);
    expect(requiresCustomsStatus("customs_cleared")).toBe(true);
    expect(requiresCustomsStatus("in_transit")).toBe(false);
  });
});

describe("damaged material disposition", () => {
  it("seeds exactly one RTV for a return disposition", () => {
    expect(shouldSeedRtv("return", 0)).toBe(true);
    expect(shouldSeedRtv("return", 1)).toBe(false);
    expect(shouldSeedRtv("scrap", 0)).toBe(false);
  });
});
