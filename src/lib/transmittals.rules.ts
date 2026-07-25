// P-091 — Transmittal pure helpers and zod schemas.
import { z } from "zod";

export const TRANSMITTAL_DIRECTIONS = ["outgoing", "incoming"] as const;
export type TransmittalDirection = (typeof TRANSMITTAL_DIRECTIONS)[number];
export const TRANSMITTAL_DIRECTION_LABELS: Record<TransmittalDirection, string> = {
  outgoing: "Outgoing",
  incoming: "Incoming",
};

export const transmittalItemSchema = z.object({
  document_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(500),
  revision: z.string().trim().max(20).nullable().optional(),
  copies: z.number().int().min(1).max(999).default(1),
});
export type TransmittalItem = z.infer<typeof transmittalItemSchema>;

export const transmittalCreateInput = z.object({
  projectId: z.string().uuid(),
  direction: z.enum(TRANSMITTAL_DIRECTIONS).default("outgoing"),
  fromParty: z.string().trim().min(1).max(200),
  toParty: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(2).max(300),
  items: z.array(transmittalItemSchema).min(1).max(200),
  responseDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type TransmittalCreateInput = z.infer<typeof transmittalCreateInput>;

export const transmittalSendInput = z.object({ id: z.string().uuid() });
export const transmittalAckInput = z.object({ id: z.string().uuid() });

const WRITE_ROLES = new Set(["construction_admin", "engineering_admin", "company_admin"]);
export function canWriteTransmittal(roles: readonly string[]): boolean {
  return roles.some((r) => WRITE_ROLES.has(r));
}

export function nextTransmittalNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^TRN-(\d+)$/i.exec(n ?? "");
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `TRN-${(max + 1).toString().padStart(4, "0")}`;
}

export function isTransmittalOverdue(row: {
  direction: TransmittalDirection;
  response_due: string | null;
  acknowledged_at: string | null;
}): boolean {
  if (row.direction !== "outgoing") return false;
  if (!row.response_due) return false;
  if (row.acknowledged_at) return false;
  const due = new Date(`${row.response_due}T23:59:59Z`).getTime();
  return Date.now() > due;
}
