// P-095 — Performance ratio test shared schemas (client + server).
import { z } from "zod";

/**
 * Computes performance ratio (%) using metered energy vs theoretical energy
 * from plane-of-array insolation and nominal DC capacity.
 *
 *   PR% = metered_MWh / (POA_kWh_m2 × capacity_MWp) × 100
 *
 * All inputs must be finite and positive; returns null on invalid input.
 */
export function computePerformanceRatio(
  meteredMwh: number | null | undefined,
  poaKwhPerM2: number | null | undefined,
  capacityMwp: number | null | undefined,
): number | null {
  if (
    meteredMwh == null ||
    poaKwhPerM2 == null ||
    capacityMwp == null ||
    !Number.isFinite(meteredMwh) ||
    !Number.isFinite(poaKwhPerM2) ||
    !Number.isFinite(capacityMwp) ||
    poaKwhPerM2 <= 0 ||
    capacityMwp <= 0 ||
    meteredMwh < 0
  ) {
    return null;
  }
  return (meteredMwh / (poaKwhPerM2 * capacityMwp)) * 100;
}

export const createPrTestInput = z
  .object({
    projectId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    meteredEnergyMwh: z.number().positive().max(10_000_000),
    poaKwhPerM2: z.number().positive().max(10_000),
    capacityMwp: z.number().positive().max(10_000),
    contractPr: z.number().positive().max(100),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "period_end_before_start",
    path: ["periodEnd"],
  });

export type CreatePrTestInput = z.infer<typeof createPrTestInput>;

export const attachPrReportInput = z.object({
  testId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(400),
  fileName: z.string().trim().min(1).max(240),
  fileSizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
});
export type AttachPrReportInput = z.infer<typeof attachPrReportInput>;
