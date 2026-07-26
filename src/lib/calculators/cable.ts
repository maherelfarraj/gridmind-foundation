// P-055 — Pure LV/MV cable sizing. Browser-safe, deterministic, no I/O.
// IEC 60228 conductor cross-sections and indicative copper ampacities.

export const IEC_60228_SIZES_MM2 = [
  1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
] as const;
export type CableSizeMm2 = (typeof IEC_60228_SIZES_MM2)[number];

// Indicative copper ampacity (A) — single-core PVC in ground, ambient 30 °C.
export const AMPACITY_A: Record<number, number> = {
  1.5: 22,
  2.5: 30,
  4: 40,
  6: 51,
  10: 70,
  16: 94,
  25: 119,
  35: 148,
  50: 180,
  70: 232,
  95: 282,
  120: 328,
  150: 379,
  185: 434,
  240: 514,
  300: 593,
  400: 683,
  500: 783,
  630: 908,
};

// Copper resistivity at 20 °C, Ω·mm²/m.
export const RHO_CU = 0.0175;
// Aluminium resistivity at 20 °C, Ω·mm²/m (P-166 extension).
export const RHO_AL = 0.0282;

export interface CableSizingInput {
  loadA: number;
  lengthM: number;
  voltageV: number;
  /** Maximum acceptable voltage drop, percent (e.g. 3 for 3%). */
  maxDropPct: number;
  /** 1 = single phase, 3 = three phase. Default 3. */
  phase?: 1 | 3;
}

export interface CableSizingResult {
  sizeMm2: number;
  ampacityOk: boolean;
  voltageDropPct: number;
  /** True when the chosen size satisfies both ampacity AND vDrop constraints. */
  valid: boolean;
}

function vDropPct(sizeMm2: number, input: CableSizingInput): number {
  const factor = (input.phase ?? 3) === 3 ? Math.sqrt(3) : 2;
  const r = (RHO_CU * input.lengthM) / sizeMm2;
  return ((factor * r * input.loadA) / input.voltageV) * 100;
}

/**
 * Select the smallest IEC 60228 size that satisfies BOTH the ampacity
 * requirement and the voltage-drop budget. When drop binds, the function
 * automatically rounds UP to the next standard size.
 */
export function selectCableSize(input: CableSizingInput): CableSizingResult {
  for (const size of IEC_60228_SIZES_MM2) {
    const drop = vDropPct(size, input);
    const ampOk = (AMPACITY_A[size] ?? 0) >= input.loadA;
    if (ampOk && drop <= input.maxDropPct) {
      return {
        sizeMm2: size,
        ampacityOk: true,
        voltageDropPct: Number(drop.toFixed(4)),
        valid: true,
      };
    }
  }
  const last = IEC_60228_SIZES_MM2[IEC_60228_SIZES_MM2.length - 1];
  const drop = vDropPct(last, input);
  return {
    sizeMm2: last,
    ampacityOk: (AMPACITY_A[last] ?? 0) >= input.loadA,
    voltageDropPct: Number(drop.toFixed(4)),
    valid: false,
  };
}
