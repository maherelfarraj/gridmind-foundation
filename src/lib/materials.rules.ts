// P-184 — Pure rules for materials & logistics.
// No React / Supabase imports: deterministic maths and validators only.
import { z } from "zod";

export const MTO_STATUSES = ["draft", "issued", "revised"] as const;
export type MtoStatus = (typeof MTO_STATUSES)[number];

export const RESERVATION_STATUSES = ["active", "fulfilled", "cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const SHIPMENT_STATUSES = [
  "preparing",
  "factory_release",
  "in_transit",
  "customs_hold",
  "customs_cleared",
  "delivered",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const DAMAGE_DISPOSITIONS = ["pending", "repair", "scrap", "return"] as const;
export type DamageDisposition = (typeof DAMAGE_DISPOSITIONS)[number];

export const RTV_STATUSES = ["requested", "approved", "shipped", "credited", "closed"] as const;
export type RtvStatus = (typeof RTV_STATUSES)[number];

export const SHORTAGE_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ShortageStatus = (typeof SHORTAGE_STATUSES)[number];

export const MATERIAL_NUMBER_PREFIXES = {
  mto: "MTO",
  reservation: "RES",
  issuance: "ISS",
  shipment: "SHP",
  deliveryNote: "DN",
  rtv: "RTV",
} as const;

/** MTO-0001 / RES-0001 style sequence numbers, per company. */
export function formatMaterialNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Next free sequence for a prefix given the numbers already issued. */
export function nextMaterialSequence(prefix: string, existing: readonly string[]): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Available = on hand − reserved, never negative. */
export function availableQty(row: { qty_on_hand: number; qty_reserved: number }): number {
  return Math.max(0, Number(row.qty_on_hand) - Number(row.qty_reserved));
}

/** A shortage exists when the active demand cannot be met from available stock. */
export function shortageFor(requiredQty: number, available: number): number {
  return requiredQty > available ? Number((requiredQty - available).toFixed(3)) : 0;
}

/**
 * Issuance against a reservation decrements reserved and on-hand by the same
 * amount; the reservation is only fulfilled once its full quantity is issued.
 */
export function applyIssuance(input: {
  qtyOnHand: number;
  qtyReserved: number;
  reservationQty: number;
  alreadyIssued: number;
  issueQty: number;
}): {
  qtyOnHand: number;
  qtyReserved: number;
  issuedTotal: number;
  reservationStatus: ReservationStatus;
} {
  const { qtyOnHand, qtyReserved, reservationQty, alreadyIssued, issueQty } = input;
  if (issueQty <= 0) throw new Error("issue qty must be greater than zero");
  const remaining = reservationQty - alreadyIssued;
  if (issueQty > remaining) throw new Error("issue qty exceeds the reserved balance");
  const issuedTotal = alreadyIssued + issueQty;
  return {
    qtyOnHand: Number((qtyOnHand - issueQty).toFixed(3)),
    qtyReserved: Number((qtyReserved - issueQty).toFixed(3)),
    issuedTotal,
    reservationStatus: issuedTotal >= reservationQty ? "fulfilled" : "active",
  };
}

const SHIPMENT_NEXT: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  preparing: ["factory_release", "cancelled"],
  factory_release: ["in_transit", "cancelled"],
  in_transit: ["customs_hold", "customs_cleared", "delivered", "cancelled"],
  customs_hold: ["customs_cleared", "cancelled"],
  customs_cleared: ["in_transit", "delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_NEXT[from].includes(to);
}

/** Customs states must always carry a recorded customs_status. */
export function requiresCustomsStatus(status: ShipmentStatus): boolean {
  return status === "customs_hold" || status === "customs_cleared";
}

/** A damaged record disposed as 'return' seeds exactly one RTV. */
export function shouldSeedRtv(
  disposition: DamageDisposition,
  existingRtvCount: number,
): boolean {
  return disposition === "return" && existingRtvCount === 0;
}

export const INSUFFICIENT_AVAILABLE_MESSAGE =
  "Insufficient available stock — reserve a smaller quantity or replenish first.";

const uuid = z.string().uuid();
const qty = z.number().positive();

export const reserveMaterialSchema = z.object({
  projectId: uuid,
  source: z.enum(["warehouse", "site"]),
  inventoryId: uuid,
  cwpId: uuid.nullable().optional(),
  qty,
});

export const issueMaterialSchema = z.object({
  projectId: uuid,
  reservationId: uuid.nullable().optional(),
  cwpId: uuid.nullable().optional(),
  dprId: uuid.nullable().optional(),
  sku: z.string().min(1),
  uom: z.string().min(1),
  issuedTo: z.string().min(1),
  qty,
});

export const shipmentSchema = z.object({
  projectId: uuid,
  purchaseOrderId: uuid.nullable().optional(),
  vendorId: uuid.nullable().optional(),
  status: z.enum(SHIPMENT_STATUSES).default("preparing"),
  customsStatus: z.string().nullable().optional(),
  trackingRef: z.string().nullable().optional(),
  eta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const damagedMaterialSchema = z.object({
  projectId: uuid,
  sku: z.string().min(1),
  material: z.string().min(1),
  qty,
  batchSerialId: uuid.nullable().optional(),
  deliveryNoteId: uuid.nullable().optional(),
  damageDescription: z.string().min(3),
  photoPath: z.string().nullable().optional(),
  disposition: z.enum(DAMAGE_DISPOSITIONS).default("pending"),
});
