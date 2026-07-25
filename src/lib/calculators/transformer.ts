// P-055 — Pure transformer sizing. Browser-safe, deterministic, no I/O.
// Standard IEC nameplate kVA ratings.

export const STANDARD_KVA = [
  25, 50, 75, 100, 150, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000,
] as const;
export type StandardKva = (typeof STANDARD_KVA)[number];

export interface TransformerSizingInput {
  loadKw: number;
  /** 0-1. Default 0.95. */
  powerFactor?: number;
  /**
   * Target nameplate loading percentage at the given load (e.g. 80 means
   * the load should occupy 80% of the selected transformer's rating).
   * Default 80. Lower target → larger transformer.
   */
  loadingPctTarget?: number;
}

export interface TransformerSizingResult {
  nameplateKva: number;
  loadKva: number;
  utilizationPct: number;
  meetsTarget: boolean;
}

export function selectTransformer(input: TransformerSizingInput): TransformerSizingResult {
  const pf = input.powerFactor ?? 0.95;
  const target = (input.loadingPctTarget ?? 80) / 100;
  const loadKva = input.loadKw / pf;
  const requiredKva = loadKva / target;
  const nameplate =
    STANDARD_KVA.find((k) => k >= requiredKva) ?? STANDARD_KVA[STANDARD_KVA.length - 1];
  const utilization = (loadKva / nameplate) * 100;
  return {
    nameplateKva: nameplate,
    loadKva: Number(loadKva.toFixed(3)),
    utilizationPct: Number(utilization.toFixed(2)),
    meetsTarget: utilization <= target * 100 + 1e-6,
  };
}
