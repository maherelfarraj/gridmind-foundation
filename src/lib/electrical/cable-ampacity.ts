// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Cable ampacity check. EXTENDS the P-055 tables in src/lib/calculators/cable.ts.
import { z } from "zod";

import { AMPACITY_A, IEC_60228_SIZES_MM2 } from "@/lib/calculators/cable";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const CABLE_AMPACITY_METHOD =
  "IEC 60364-5-52-style current-carrying capacity check. The base ampacity is the P-055 copper " +
  "reference table (single-core, buried, 30 °C ambient). Aluminium conductors are factored by " +
  "0.78. The installation method applies a further factor (buried 1.00, tray 1.05, free air 1.10). " +
  "The derated capacity is I_z = I_base · k_material · k_install · k_temp · k_group, where k_temp " +
  "is interpolated from the 30 °C reference. The circuit passes when I_z ≥ I_load.";

export const CABLE_MATERIALS = ["cu", "al"] as const;
export const CABLE_INSTALLATIONS = ["buried", "tray", "air"] as const;

export const MATERIAL_FACTOR: Record<(typeof CABLE_MATERIALS)[number], number> = {
  cu: 1,
  al: 0.78,
};

export const INSTALLATION_FACTOR: Record<(typeof CABLE_INSTALLATIONS)[number], number> = {
  buried: 1,
  tray: 1.05,
  air: 1.1,
};

/** Temperature correction factors for a 30 °C reference ambient (PVC insulation). */
const TEMPERATURE_FACTORS: Array<[number, number]> = [
  [10, 1.22],
  [15, 1.17],
  [20, 1.12],
  [25, 1.06],
  [30, 1.0],
  [35, 0.94],
  [40, 0.87],
  [45, 0.79],
  [50, 0.71],
  [55, 0.61],
  [60, 0.5],
];

/** Linear interpolation between table points; clamped at both ends. */
export function temperatureFactor(ambientC: number): number {
  const first = TEMPERATURE_FACTORS[0];
  const last = TEMPERATURE_FACTORS[TEMPERATURE_FACTORS.length - 1];
  if (ambientC <= first[0]) return first[1];
  if (ambientC >= last[0]) return last[1];
  for (let i = 1; i < TEMPERATURE_FACTORS.length; i += 1) {
    const [t1, f1] = TEMPERATURE_FACTORS[i - 1];
    const [t2, f2] = TEMPERATURE_FACTORS[i];
    if (ambientC <= t2) {
      const ratio = (ambientC - t1) / (t2 - t1);
      return f1 + ratio * (f2 - f1);
    }
  }
  return last[1];
}

export const cableAmpacityInputSchema = z.object({
  loadA: z.number().positive(),
  standardMm2: z.number().positive(),
  material: z.enum(CABLE_MATERIALS).default("cu"),
  installation: z.enum(CABLE_INSTALLATIONS).default("buried"),
  ambientC: z.number().min(-20).max(80).default(30),
  groupingFactor: z.number().min(0.1).max(1).default(1),
});

export type CableAmpacityInput = z.infer<typeof cableAmpacityInputSchema>;

export type CableAmpacityResults = {
  inputSheet: CableAmpacityInput;
  ampacityA: number;
  deratedA: number;
  utilizationPct: number;
  materialFactor: number;
  installationFactor: number;
  temperatureFactor: number;
  groupingFactor: number;
  ok: boolean;
};

export function checkCableAmpacity(
  rawInput: CableAmpacityInput,
): CalcOutput<CableAmpacityResults> {
  const input = cableAmpacityInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const base = AMPACITY_A[input.standardMm2];
  if (base === undefined) {
    warnings.push(
      warn(
        "non_standard_size",
        "critical",
        `${input.standardMm2} mm² is not an IEC 60228 size in the reference table ` +
          `(${IEC_60228_SIZES_MM2.join(", ")} mm²).`,
      ),
    );
  }

  const kMaterial = MATERIAL_FACTOR[input.material];
  const kInstall = INSTALLATION_FACTOR[input.installation];
  const kTemp = temperatureFactor(input.ambientC);
  const ampacityA = (base ?? 0) * kMaterial * kInstall;
  const deratedA = ampacityA * kTemp * input.groupingFactor;
  const ok = deratedA >= input.loadA;

  if (base !== undefined && !ok) {
    warnings.push(
      warn(
        "ampacity_exceeded",
        "critical",
        `Load ${input.loadA} A exceeds the derated capacity ${round(deratedA, 2)} A of a ` +
          `${input.standardMm2} mm² ${input.material.toUpperCase()} cable. Increase the size, ` +
          "split the circuit or improve the installation conditions.",
      ),
    );
  } else if (base !== undefined && deratedA < input.loadA * 1.1) {
    warnings.push(
      warn(
        "ampacity_margin_low",
        "warning",
        `Only ${round(((deratedA - input.loadA) / input.loadA) * 100, 1)}% headroom remains over ` +
          "the design load; consider the next standard size for growth.",
      ),
    );
  }
  if (input.groupingFactor < 1) {
    warnings.push(
      warn(
        "grouping_applied",
        "info",
        `A grouping factor of ${input.groupingFactor} was applied — confirm it against the final ` +
          "cable-tray fill and trench layout.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      ampacityA: round(ampacityA, 3),
      deratedA: round(deratedA, 3),
      utilizationPct: deratedA > 0 ? round((input.loadA / deratedA) * 100, 2) : 0,
      materialFactor: kMaterial,
      installationFactor: kInstall,
      temperatureFactor: round(kTemp, 4),
      groupingFactor: input.groupingFactor,
      ok,
    },
    warnings,
    assumptionsEcho: [
      assumption("base_table", "P-055 copper ampacity, single-core buried @ 30 °C", "IEC 60364-5-52 style"),
      assumption("reference_ambient_c", 30, "GridMind base table"),
      assumption("material_factor", kMaterial, `Conductor ${input.material}`),
      assumption("installation_factor", kInstall, `Installation ${input.installation}`),
      assumption("temperature_factor", round(kTemp, 4), `Ambient ${input.ambientC} °C`),
      assumption("grouping_factor", input.groupingFactor, "Input sheet"),
    ],
  };
}
