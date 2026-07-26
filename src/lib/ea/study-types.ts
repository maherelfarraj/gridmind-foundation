// P-165 — Electrical-analysis study catalogue. Pure metadata + zod primitives,
// shared by the server functions, the workspace UI and the report exporter.
// No React, no Supabase: keep this module importable from tests.

export const EA_STUDY_TYPES = [
  "load_flow",
  "short_circuit",
  "cable_ampacity",
  "voltage_drop",
  "transformer_loading",
  "motor_starting",
  "protection_schedule",
  "harmonics",
  "grounding",
  "arc_flash",
  "dc_system",
  "aux_ac",
  "ups_battery",
  "generator_sizing",
  "capacitor_bank",
  "reactive_power",
  "pf_correction",
  "grid_code_checklist",
] as const;

export type EaStudyType = (typeof EA_STUDY_TYPES)[number];

export const EA_STUDY_STATUSES = ["draft", "under_review", "approved"] as const;
export type EaStudyStatus = (typeof EA_STUDY_STATUSES)[number];

export const EA_APPROVAL_RULE_KEY = "ea_study_approval";
export const EA_APPROVAL_ENTITY = "ea_study";

/**
 * Honesty disclaimer shown on every study screen and printed on every report.
 * GridMind computes engineering estimates; it does not certify them.
 */
export const EA_DISCLAIMER =
  "Not formally validated. This study is an engineering aid produced by GridMind and " +
  "must be reviewed, adjusted and signed by a qualified professional engineer before " +
  "it is used for procurement, construction or any submission. No compliance claim is " +
  "made against any standard listed in the references.";

export type EaStudyTypeSpec = {
  type: EaStudyType;
  label: string;
  group: "power_system" | "protection" | "auxiliary" | "compliance";
  summary: string;
  /** Reference texts offered by default — descriptive, never a compliance claim. */
  defaultStandards: string[];
};

export const EA_STUDY_SPECS: Record<EaStudyType, EaStudyTypeSpec> = {
  load_flow: {
    type: "load_flow",
    label: "Load flow",
    group: "power_system",
    summary: "Bus voltages, branch flows and losses across the collection network.",
    defaultStandards: ["IEC 60038", "IEEE 399"],
  },
  short_circuit: {
    type: "short_circuit",
    label: "Short-circuit (IEC 60909)",
    group: "power_system",
    summary: "Initial symmetrical, peak and breaking fault currents at each bus.",
    defaultStandards: ["IEC 60909-0"],
  },
  cable_ampacity: {
    type: "cable_ampacity",
    label: "Cable ampacity",
    group: "power_system",
    summary: "Derated current-carrying capacity for the installed laying method.",
    defaultStandards: ["IEC 60364-5-52", "IEC 60287"],
  },
  voltage_drop: {
    type: "voltage_drop",
    label: "Voltage drop",
    group: "power_system",
    summary: "Steady-state drop per circuit against the project allowance.",
    defaultStandards: ["IEC 60364-5-52"],
  },
  transformer_loading: {
    type: "transformer_loading",
    label: "Transformer loading",
    group: "power_system",
    summary: "Loading ratio, losses and ambient/ONAN derating headroom.",
    defaultStandards: ["IEC 60076-7"],
  },
  motor_starting: {
    type: "motor_starting",
    label: "Motor starting",
    group: "power_system",
    summary: "Starting current and voltage dip at the point of connection.",
    defaultStandards: ["IEEE 399"],
  },
  protection_schedule: {
    type: "protection_schedule",
    label: "Protection schedule",
    group: "protection",
    summary: "Device schedule with relay functions and setting groups.",
    defaultStandards: ["IEC 60255", "IEEE C37.112"],
  },
  harmonics: {
    type: "harmonics",
    label: "Harmonics",
    group: "protection",
    summary: "Voltage/current distortion estimate at the point of common coupling.",
    defaultStandards: ["IEEE 519", "IEC 61000-3-6"],
  },
  grounding: {
    type: "grounding",
    label: "Grounding",
    group: "protection",
    summary: "Grid resistance, step and touch potential estimates.",
    defaultStandards: ["IEEE 80"],
  },
  arc_flash: {
    type: "arc_flash",
    label: "Arc flash",
    group: "protection",
    summary: "Incident energy and boundary estimates per equipment location.",
    defaultStandards: ["IEEE 1584"],
  },
  dc_system: {
    type: "dc_system",
    label: "DC system",
    group: "auxiliary",
    summary: "Station battery duty cycle, charger sizing and DC distribution.",
    defaultStandards: ["IEEE 485"],
  },
  aux_ac: {
    type: "aux_ac",
    label: "Auxiliary AC",
    group: "auxiliary",
    summary: "Station service load list, LV distribution and diversity.",
    defaultStandards: ["IEC 60364"],
  },
  ups_battery: {
    type: "ups_battery",
    label: "UPS / battery",
    group: "auxiliary",
    summary: "Autonomy, string sizing and end-of-discharge voltage.",
    defaultStandards: ["IEEE 1184", "IEEE 485"],
  },
  generator_sizing: {
    type: "generator_sizing",
    label: "Generator sizing",
    group: "auxiliary",
    summary: "Standby genset rating against step loads and transient dip.",
    defaultStandards: ["ISO 8528-1"],
  },
  capacitor_bank: {
    type: "capacitor_bank",
    label: "Capacitor bank",
    group: "compliance",
    summary: "Bank sizing, step resolution and resonance screening.",
    defaultStandards: ["IEEE 18", "IEC 60871"],
  },
  reactive_power: {
    type: "reactive_power",
    label: "Reactive power",
    group: "compliance",
    summary: "Q capability at the connection point across the P range.",
    defaultStandards: ["IEC 61400-21", "Grid code"],
  },
  pf_correction: {
    type: "pf_correction",
    label: "Power-factor correction",
    group: "compliance",
    summary: "Correction kvar required to reach the contracted power factor.",
    defaultStandards: ["IEC 61642"],
  },
  grid_code_checklist: {
    type: "grid_code_checklist",
    label: "Grid-code checklist",
    group: "compliance",
    summary: "Point-by-point response to the connecting utility's requirements.",
    defaultStandards: ["NEPCO grid code"],
  },
};

export const EA_STUDY_LIST: EaStudyTypeSpec[] = EA_STUDY_TYPES.map((t) => EA_STUDY_SPECS[t]);

export const EA_STUDY_GROUP_LABELS: Record<EaStudyTypeSpec["group"], string> = {
  power_system: "Power system",
  protection: "Protection & safety",
  auxiliary: "Auxiliary systems",
  compliance: "Compliance & grid code",
};

/** EA-0001 … EA-9999+, zero-padded to four digits, never truncated. */
export function formatStudyNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("study sequence must be a positive integer");
  }
  return `EA-${String(sequence).padStart(4, "0")}`;
}

/** Parses EA-#### back to its sequence, or null when the shape is foreign. */
export function parseStudyNumber(value: string): number | null {
  const match = /^EA-(\d{4,})$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Next free sequence given the numbers already issued to a company. */
export function nextStudySequence(existing: readonly string[]): number {
  let max = 0;
  for (const value of existing) {
    const seq = parseStudyNumber(value);
    if (seq !== null && seq > max) max = seq;
  }
  return max + 1;
}

export type EaWarningSeverity = "info" | "warning" | "error";

export type EaWarning = {
  code: string;
  severity: EaWarningSeverity;
  message: string;
};

export type EaAssumption = {
  text: string;
  source: string;
};

/** Transitions the frontend may request; the server is the only writer. */
export function canTransition(from: EaStudyStatus, to: EaStudyStatus): boolean {
  if (from === "draft") return to === "under_review";
  if (from === "under_review") return to === "approved" || to === "draft";
  return false;
}

/** Approved studies are frozen; edits require a new revision. */
export function isEditable(status: EaStudyStatus): boolean {
  return status === "draft";
}
