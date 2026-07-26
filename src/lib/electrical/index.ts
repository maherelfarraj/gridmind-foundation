// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Calculator registry: maps an EA study type to its schema, METHOD text and compute fn.
// Pure module — no React, no Supabase, no route imports.
import type { z } from "zod";

import {
  cableAmpacityInputSchema,
  checkCableAmpacity,
  CABLE_AMPACITY_METHOD,
} from "./cable-ampacity";
import { loadFlowInputSchema, radialLoadFlow, LOAD_FLOW_METHOD } from "./load-flow";
import {
  shortCircuitInputSchema,
  shortCircuitStudy,
  SHORT_CIRCUIT_METHOD,
} from "./short-circuit";
import {
  transformerLoading,
  transformerLoadingInputSchema,
  TRANSFORMER_LOADING_METHOD,
} from "./transformer-loading";
import type { CalcOutput } from "./types";
import { voltageDrop, voltageDropInputSchema, VOLTAGE_DROP_METHOD } from "./voltage-drop";

export * from "./types";
export * from "./load-flow";
export * from "./short-circuit";
export * from "./cable-ampacity";
export * from "./voltage-drop";
export * from "./transformer-loading";

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

export type Wave1StudyType = keyof typeof WAVE1_CALCULATORS;

export const WAVE1_STUDY_TYPES = Object.keys(WAVE1_CALCULATORS) as Wave1StudyType[];

export function isWave1StudyType(value: string): value is Wave1StudyType {
  return Object.prototype.hasOwnProperty.call(WAVE1_CALCULATORS, value);
}

export function getCalculator(studyType: Wave1StudyType): Calculator {
  return WAVE1_CALCULATORS[studyType];
}
