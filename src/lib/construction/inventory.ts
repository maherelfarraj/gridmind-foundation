// P-186 — Pure inventory reservation math. No React / Supabase imports.
import { applyIssuance as applyMaterialIssuance, availableQty } from "@/lib/materials.rules";

const EPS = 1e-9;

/** Available = on hand − reserved, never negative. */
export function available(onHand: number, reserved: number): number {
  return availableQty({ qty_on_hand: onHand, qty_reserved: reserved });
}

/** A reservation is allowed only for a positive qty that fits the availability. */
export function canReserve(qty: number, availableQtyValue: number): boolean {
  if (!Number.isFinite(qty) || qty <= 0) return false;
  return qty <= availableQtyValue + EPS;
}

/** Issuance decrements reserved and on-hand together; never above reserved. */
export function applyIssuance(input: { onHand: number; reserved: number; qty: number }): {
  onHand: number;
  reserved: number;
} {
  const { onHand, reserved, qty } = input;
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("issue qty must be greater than zero");
  if (qty > reserved + EPS) throw new Error("issue qty exceeds the reserved balance");
  const next = applyMaterialIssuance({
    qtyOnHand: onHand,
    qtyReserved: reserved,
    reservationQty: reserved,
    alreadyIssued: 0,
    issueQty: qty,
  });
  return { onHand: next.qtyOnHand, reserved: next.qtyReserved };
}
