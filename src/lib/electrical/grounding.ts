// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-168 — Grounding SCREENING worksheet (Sverak simplified grid resistance + tolerable-voltage screen).
// This is not a detailed IEEE 80 analysis and makes no compliance claim.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const GROUNDING_METHOD =
  "Grid resistance uses the Sverak simplified expression Rg = ρ·[1/L_T + 1/√(20A)·(1 + 1/(1 + h·√(20/A)))] " +
  "with A the grid area, L_T the total buried conductor length (estimated from the mesh spacing when not " +
  "declared) and h the burial depth. Ground-potential rise is GPR = Rg·I_f. Tolerable touch and step " +
  "voltages use the simplified IEEE 80 body-current formulas for the declared body weight with no crushed-" +
  "rock surface layer (Cs = 1, ρs = ρ). GPR is compared directly against the tolerable touch voltage as a " +
  "conservative SCREEN — mesh and step voltages are not computed. Conductor size is screened with " +
  "A_min = I_f(kA)·K_f·√t_c. A failed screen means a detailed IEEE 80 analysis is required, not that the " +
  "design is unsafe.";

export const groundingInputSchema = z.object({
  gridLengthM: z.number().positive(),
  gridWidthM: z.number().positive(),
  burialDepthM: z.number().min(0.1).max(3).default(0.6),
  conductorMm2: z.number().positive().default(120),
  soilResistivityOhmM: z.number().positive(),
  faultCurrentKa: z.number().positive(),
  clearingTimeS: z.number().positive().max(60),
  bodyWeightKg: z.number().min(40).max(120).default(70),
  meshSpacingM: z.number().positive().max(50).default(10),
  conductorMaterial: z.enum(["copper", "copper_clad_steel", "galvanized_steel"]).default("copper"),
});

export type GroundingInput = z.infer<typeof groundingInputSchema>;

/** IEEE 80 K_f constants (fusing/limit temperature dependent), mm² per kA·√s. */
export const KF_BY_MATERIAL: Record<GroundingInput["conductorMaterial"], number> = {
  copper: 7.0,
  copper_clad_steel: 10.45,
  galvanized_steel: 15.95,
};

export type GroundingResults = {
  inputSheet: GroundingInput;
  areaM2: number;
  conductorLengthM: number;
  gridResistanceOhm: number;
  gprVolts: number;
  tolerableTouchV: number;
  tolerableStepV: number;
  touchScreenPass: boolean;
  gprToTouchRatio: number;
  minConductorMm2: number;
  conductorScreenPass: boolean;
  bodyFactor: number;
};

/** Total buried conductor length for a rectangular mesh at the declared spacing. */
export function meshConductorLength(lengthM: number, widthM: number, spacingM: number): number {
  const nAlongWidth = Math.floor(widthM / spacingM) + 1; // conductors running the length
  const nAlongLength = Math.floor(lengthM / spacingM) + 1; // conductors running the width
  return nAlongWidth * lengthM + nAlongLength * widthM;
}

export function sverakGridResistance(
  rhoOhmM: number,
  areaM2: number,
  conductorLengthM: number,
  depthM: number,
): number {
  const sqrt20A = Math.sqrt(20 * areaM2);
  const term =
    1 / conductorLengthM + (1 / sqrt20A) * (1 + 1 / (1 + depthM * Math.sqrt(20 / areaM2)));
  return rhoOhmM * term;
}

export function groundingWorksheet(input: GroundingInput): CalcOutput<GroundingResults> {
  const warnings: CalcWarning[] = [];
  const areaM2 = input.gridLengthM * input.gridWidthM;
  const conductorLengthM = meshConductorLength(
    input.gridLengthM,
    input.gridWidthM,
    input.meshSpacingM,
  );
  const rg = sverakGridResistance(
    input.soilResistivityOhmM,
    areaM2,
    conductorLengthM,
    input.burialDepthM,
  );
  const gpr = rg * input.faultCurrentKa * 1000;

  // IEEE 80 body-current constant: 0.116 for 50 kg, 0.157 for 70 kg.
  const bodyFactor = input.bodyWeightKg >= 70 ? 0.157 : 0.116;
  const rhoSurface = input.soilResistivityOhmM; // Cs = 1, no crushed-rock layer declared
  const sqrtT = Math.sqrt(input.clearingTimeS);
  const tolerableTouchV = ((1000 + 1.5 * rhoSurface) * bodyFactor) / sqrtT;
  const tolerableStepV = ((1000 + 6 * rhoSurface) * bodyFactor) / sqrtT;

  const touchScreenPass = gpr <= tolerableTouchV;
  const kf = KF_BY_MATERIAL[input.conductorMaterial];
  const minConductorMm2 = input.faultCurrentKa * kf * sqrtT;
  const conductorScreenPass = input.conductorMm2 >= minConductorMm2;

  if (!touchScreenPass) {
    warnings.push(
      warn(
        "touch_screen_failed",
        "critical",
        `Ground-potential rise ${round(gpr, 0)} V exceeds the tolerable touch voltage ${round(tolerableTouchV, 0)} V — detailed IEEE 80 analysis required (mesh/step voltages, surface layer, soil model).`,
      ),
    );
  } else {
    warnings.push(
      warn(
        "screen_only",
        "info",
        "GPR is below the tolerable touch voltage under this screen. Mesh and step voltages were not computed — a detailed IEEE 80 analysis is still required before issue for construction.",
      ),
    );
  }
  if (!conductorScreenPass) {
    warnings.push(
      warn(
        "conductor_undersized",
        "critical",
        `Declared conductor ${input.conductorMm2} mm² is below the thermal minimum ${round(minConductorMm2, 1)} mm² for ${input.faultCurrentKa} kA over ${input.clearingTimeS} s.`,
      ),
    );
  }
  if (input.soilResistivityOhmM > 500) {
    warnings.push(
      warn(
        "high_soil_resistivity",
        "warning",
        `Soil resistivity ${input.soilResistivityOhmM} Ω·m is high; a two-layer soil model and deep rods should be considered in the detailed analysis.`,
      ),
    );
  }
  if (input.clearingTimeS > 1) {
    warnings.push(
      warn(
        "long_clearing_time",
        "warning",
        `Clearing time ${input.clearingTimeS} s is long; confirm it against the approved protection settings.`,
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      areaM2: round(areaM2, 2),
      conductorLengthM: round(conductorLengthM, 2),
      gridResistanceOhm: round(rg, 4),
      gprVolts: round(gpr, 2),
      tolerableTouchV: round(tolerableTouchV, 2),
      tolerableStepV: round(tolerableStepV, 2),
      touchScreenPass,
      gprToTouchRatio: round(gpr / tolerableTouchV, 3),
      minConductorMm2: round(minConductorMm2, 2),
      conductorScreenPass,
      bodyFactor,
    },
    warnings,
    assumptionsEcho: [
      assumption("surface_layer", "none (Cs = 1, ρs = ρ)", "GridMind screening default"),
      assumption("body_weight_kg", input.bodyWeightKg, "input sheet"),
      assumption("mesh_spacing_m", input.meshSpacingM, "input sheet"),
      assumption("kf", kf, `IEEE 80 (${input.conductorMaterial})`),
      assumption("screen_basis", "GPR vs tolerable touch voltage", "conservative screen"),
    ],
  };
}
