// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Calculator registry: maps an EA study type to its schema, METHOD text and compute fn.
// Pure module — no React, no Supabase, no route imports.
import type { z } from "zod";

import {
  cableAmpacityInputSchema,
  checkCableAmpacity,
  CABLE_AMPACITY_METHOD,
} from "./cable-ampacity";
import { auxAcCalc, auxAcInputSchema, AUX_AC_METHOD } from "./aux-ac";
import {
  capacitorBankInputSchema,
  pfCorrectionCheck,
  pfCorrectionInputSchema,
  reactivePowerInputSchema,
  reactivePowerRequirement,
  sizeCapacitorBank,
  CAPACITOR_BANK_METHOD,
  PF_CORRECTION_METHOD,
  REACTIVE_POWER_METHOD,
} from "./capacitor-bank";
import { dcSystemCalc, dcSystemInputSchema, DC_SYSTEM_METHOD } from "./dc-system";
import {
  generatorSizingInputSchema,
  sizeGenerator,
  GENERATOR_SIZING_METHOD,
} from "./generator-sizing";
import { loadFlowInputSchema, radialLoadFlow, LOAD_FLOW_METHOD } from "./load-flow";
import { shortCircuitInputSchema, shortCircuitStudy, SHORT_CIRCUIT_METHOD } from "./short-circuit";
import {
  transformerLoading,
  transformerLoadingInputSchema,
  TRANSFORMER_LOADING_METHOD,
} from "./transformer-loading";
import type { CalcOutput } from "./types";
import { sizeUpsBattery, upsBatteryInputSchema, UPS_BATTERY_METHOD } from "./ups-battery";
import { voltageDrop, voltageDropInputSchema, VOLTAGE_DROP_METHOD } from "./voltage-drop";

export * from "./types";
export * from "./load-flow";
export * from "./short-circuit";
export * from "./cable-ampacity";
export * from "./voltage-drop";
export * from "./transformer-loading";
export * from "./ups-battery";
export * from "./generator-sizing";
export * from "./capacitor-bank";
export * from "./dc-system";
export * from "./aux-ac";

export type Calculator = {
  studyType: string;
  method: string;
  inputSchema: z.ZodTypeAny;
  compute: (input: unknown) => CalcOutput<unknown>;
};

/** Wave 1 calculators, keyed by ea_studies.study_type. */
export const WAVE1_CALCULATORS = {
  load_flow: {
    studyType: "load_flow",
    method: LOAD_FLOW_METHOD,
    inputSchema: loadFlowInputSchema,
    compute: (input: unknown) => radialLoadFlow(loadFlowInputSchema.parse(input)),
  },
  short_circuit: {
    studyType: "short_circuit",
    method: SHORT_CIRCUIT_METHOD,
    inputSchema: shortCircuitInputSchema,
    compute: (input: unknown) => shortCircuitStudy(shortCircuitInputSchema.parse(input)),
  },
  cable_ampacity: {
    studyType: "cable_ampacity",
    method: CABLE_AMPACITY_METHOD,
    inputSchema: cableAmpacityInputSchema,
    compute: (input: unknown) => checkCableAmpacity(cableAmpacityInputSchema.parse(input)),
  },
  voltage_drop: {
    studyType: "voltage_drop",
    method: VOLTAGE_DROP_METHOD,
    inputSchema: voltageDropInputSchema,
    compute: (input: unknown) => voltageDrop(voltageDropInputSchema.parse(input)),
  },
  transformer_loading: {
    studyType: "transformer_loading",
    method: TRANSFORMER_LOADING_METHOD,
    inputSchema: transformerLoadingInputSchema,
    compute: (input: unknown) => transformerLoading(transformerLoadingInputSchema.parse(input)),
  },
} satisfies Record<string, Calculator>;

/** Wave 2 calculators, keyed by ea_studies.study_type. */
export const WAVE2_CALCULATORS = {
  ups_battery: {
    studyType: "ups_battery",
    method: UPS_BATTERY_METHOD,
    inputSchema: upsBatteryInputSchema,
    compute: (input: unknown) => sizeUpsBattery(upsBatteryInputSchema.parse(input)),
  },
  generator_sizing: {
    studyType: "generator_sizing",
    method: GENERATOR_SIZING_METHOD,
    inputSchema: generatorSizingInputSchema,
    compute: (input: unknown) => sizeGenerator(generatorSizingInputSchema.parse(input)),
  },
  capacitor_bank: {
    studyType: "capacitor_bank",
    method: CAPACITOR_BANK_METHOD,
    inputSchema: capacitorBankInputSchema,
    compute: (input: unknown) => sizeCapacitorBank(capacitorBankInputSchema.parse(input)),
  },
  reactive_power: {
    studyType: "reactive_power",
    method: REACTIVE_POWER_METHOD,
    inputSchema: reactivePowerInputSchema,
    compute: (input: unknown) => reactivePowerRequirement(reactivePowerInputSchema.parse(input)),
  },
  pf_correction: {
    studyType: "pf_correction",
    method: PF_CORRECTION_METHOD,
    inputSchema: pfCorrectionInputSchema,
    compute: (input: unknown) => pfCorrectionCheck(pfCorrectionInputSchema.parse(input)),
  },
  dc_system: {
    studyType: "dc_system",
    method: DC_SYSTEM_METHOD,
    inputSchema: dcSystemInputSchema,
    compute: (input: unknown) => dcSystemCalc(dcSystemInputSchema.parse(input)),
  },
  aux_ac: {
    studyType: "aux_ac",
    method: AUX_AC_METHOD,
    inputSchema: auxAcInputSchema,
    compute: (input: unknown) => auxAcCalc(auxAcInputSchema.parse(input)),
  },
} satisfies Record<string, Calculator>;

/** Every wired calculator — the single source of truth for the EA record bridge. */
export const CALCULATORS = { ...WAVE1_CALCULATORS, ...WAVE2_CALCULATORS };

export type Wave1StudyType = keyof typeof WAVE1_CALCULATORS;
export type Wave2StudyType = keyof typeof WAVE2_CALCULATORS;
export type CalculatorStudyType = keyof typeof CALCULATORS;

export const WAVE1_STUDY_TYPES = Object.keys(WAVE1_CALCULATORS) as Wave1StudyType[];
export const WAVE2_STUDY_TYPES = Object.keys(WAVE2_CALCULATORS) as Wave2StudyType[];
export const CALCULATOR_STUDY_TYPES = Object.keys(CALCULATORS) as CalculatorStudyType[];

export function isWave1StudyType(value: string): value is Wave1StudyType {
  return Object.prototype.hasOwnProperty.call(WAVE1_CALCULATORS, value);
}

export function isCalculatorStudyType(value: string): value is CalculatorStudyType {
  return Object.prototype.hasOwnProperty.call(CALCULATORS, value);
}

export function getCalculator(studyType: CalculatorStudyType): Calculator {
  return CALCULATORS[studyType];
}
