// P-066 — Pure Goods Receipt (GRN) helpers: numbering, status derivation,
// PO status projection, and Zod schemas. Kept side-effect free so it can be
// unit-tested and imported from both the browser and the server.

import { z } from "zod";
import type { PoLine, PoStatus } from "@/lib/po-rules";

export const GRN_STATUSES = [
  "draft",
  "confirmed",
  "has_defects",
  "closed",
] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

export const GRN_CONDITIONS = ["ok", "damaged", "partial"] as const;
export type GrnCondition = (typeof GRN_CONDITIONS)[number];

// ---------------------------------------------------------------------------
// numbering
// ---------------------------------------------------------------------------
export function formatGrnNumber(n: number): string {
  return `GRN-${String(n).padStart(4, "0")}`;
}

export function parseGrnNumber(s: string): number | null {
  const m = /^GRN-(\d+)$/i.exec(s ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function nextGrnNumber(existing: string[]): string {
  const nums = existing
    .map(parseGrnNumber)
    .filter((n): n is number => n != null);
  const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
  return formatGrnNumber(next);
}

// ---------------------------------------------------------------------------
// domain types
// ---------------------------------------------------------------------------
export interface GrnLine {
  po_line_no: number;
  description: string;
  uom: string;
  qty_ordered: number;
  qty_received: number;
  lot_ids: string[];
  condition: GrnCondition;
  defect_notes: string | null;
}

export interface ReceivableLine {
  po_line_no: number;
  description: string;
  uom: string;
  qty_ordered: number;
  qty_already_received: number;
  qty_remaining: number;
}

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
export const grnLineSchema = z.object({
  po_line_no: z.number().int().min(1).max(9999),
  description: z.string().trim().max(500),
  uom: z.string().trim().max(32),
  qty_ordered: z.number().min(0),
  qty_received: z.number().min(0),
  lot_ids: z
    .array(z.string().trim().min(1).max(120))
    .max(200)
    .default([]),
  condition: z.enum(GRN_CONDITIONS),
  defect_notes: z.string().trim().max(2000).nullable().optional(),
});

export const grnDraftPayload = z.object({
  lines: z.array(grnLineSchema).min(1),
  notes: z.string().trim().max(4000).nullable().optional(),
  photos: z.array(z.string().trim().min(3).max(500)).max(10).default([]),
});
export type GrnDraftPayload = z.infer<typeof grnDraftPayload>;

// ---------------------------------------------------------------------------
// business rules
// ---------------------------------------------------------------------------
/** Validate that no line receives more than what is still due. Returns list of
 *  offending line numbers (empty when clean). */
export function overReceivedLines(
  proposed: GrnLine[],
  receivable: ReceivableLine[],
): number[] {
  const remainingByNo = new Map(
    receivable.map((r) => [r.po_line_no, r.qty_remaining]),
  );
  const bad: number[] = [];
  for (const l of proposed) {
    const remaining = remainingByNo.get(l.po_line_no) ?? 0;
    // Tolerate floating point noise up to 1e-6.
    if (l.qty_received - remaining > 1e-6) bad.push(l.po_line_no);
  }
  return bad;
}

/** Derives GRN status from proposed lines. Any non-OK condition, defect note,
 *  or short-ship (qty_received < qty_ordered) surfaces as has_defects. */
export function deriveGrnStatus(lines: GrnLine[]): GrnStatus {
  const hasDefect = lines.some(
    (l) =>
      l.condition !== "ok" ||
      (l.defect_notes && l.defect_notes.trim().length > 0) ||
      l.qty_received + 1e-6 < l.qty_ordered,
  );
  return hasDefect ? "has_defects" : "confirmed";
}

export function countDefects(lines: GrnLine[]): number {
  return lines.filter(
    (l) =>
      l.condition !== "ok" ||
      (l.defect_notes && l.defect_notes.trim().length > 0),
  ).length;
}

/** Given the PO lines and ALL confirmed GRN lines against the PO so far,
 *  decide the PO status. Returns "received" when every PO line is met or
 *  exceeded (rare — treat overs at data-entry time), "partially_received"
 *  when any receipts exist, or null when no change is warranted. */
export function computePoStatusAfterGrn(
  poLines: Pick<PoLine, "line_no" | "qty">[],
  confirmedLines: Pick<GrnLine, "po_line_no" | "qty_received">[],
): PoStatus | null {
  if (poLines.length === 0) return null;
  const receivedByLine = new Map<number, number>();
  for (const l of confirmedLines) {
    receivedByLine.set(
      l.po_line_no,
      (receivedByLine.get(l.po_line_no) ?? 0) + Number(l.qty_received || 0),
    );
  }
  const totalReceived = Array.from(receivedByLine.values()).reduce(
    (a, b) => a + b,
    0,
  );
  if (totalReceived <= 0) return null;
  const allFull = poLines.every((pl) => {
    const got = receivedByLine.get(pl.line_no) ?? 0;
    return got + 1e-6 >= Number(pl.qty || 0);
  });
  return allFull ? "received" : "partially_received";
}

/** Enforce that a storage path is scoped to `{company_id}/grn/{grn_id}/…`. */
export function assertGrnPhotoPath(
  path: string,
  companyId: string,
  grnId: string,
): void {
  const prefix = `${companyId}/grn/${grnId}/`;
  if (!path.startsWith(prefix)) {
    throw new Error(`invalid_photo_path:${path}`);
  }
  if (path.includes("..")) throw new Error("invalid_photo_path");
}
