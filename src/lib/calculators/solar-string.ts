// P-055 — Pure solar-string sizing check. Browser-safe, deterministic.
// Verifies that a proposed modules-per-string configuration stays within
// inverter Vdc-max at record cold and MPPT window at record hot.

export interface SolarStringInput {
  /** Module STC open-circuit voltage (V). */
  moduleVoc: number;
  /** Module STC voltage at max power (V). */
  moduleVmp: number;
  /** Voc temperature coefficient, %/°C (typically negative, e.g. -0.28). */
  tempCoeffVocPctPerC: number;
  /** Vmp temperature coefficient, %/°C. Falls back to Voc coefficient. */
  tempCoeffVmpPctPerC?: number;
  /** Record cold ambient (°C). Used for Voc worst case. */
  minTempC: number;
  /** Record hot cell temperature (°C). Used for Vmp worst case. */
  maxTempC: number;
  /** Inverter absolute DC input maximum (V). */
  inverterMaxVdc: number;
  /** Inverter MPPT tracking minimum (V). */
  inverterMpptMinVdc: number;
  /** Inverter MPPT tracking maximum (V). */
  inverterMpptMaxVdc: number;
  /** Proposed modules in series per string. */
  modulesPerString: number;
}

export type SolarStringInvalidReason =
  | "voc_exceeds_inverter_max"
  | "vmp_below_mppt_min"
  | "vmp_above_mppt_max";

export interface SolarStringResult {
  valid: boolean;
  reason?: SolarStringInvalidReason;
  coldVocPerModule: number;
  hotVmpPerModule: number;
  stringVocCold: number;
  stringVmpHot: number;
  /** Minimum modules needed to stay at/above MPPT-min at record hot. */
  minModulesForMpptMin: number;
  /** Maximum modules allowed before Voc-cold exceeds inverter Vdc-max. */
  maxModulesForVocMax: number;
}

const STC_TEMP_C = 25;

export function evaluateSolarString(input: SolarStringInput): SolarStringResult {
  const vmpCoef = input.tempCoeffVmpPctPerC ?? input.tempCoeffVocPctPerC;
  const dtCold = input.minTempC - STC_TEMP_C;
  const dtHot = input.maxTempC - STC_TEMP_C;

  const coldVocPerModule = input.moduleVoc * (1 + (input.tempCoeffVocPctPerC / 100) * dtCold);
  const hotVmpPerModule = input.moduleVmp * (1 + (vmpCoef / 100) * dtHot);
  const stringVocCold = coldVocPerModule * input.modulesPerString;
  const stringVmpHot = hotVmpPerModule * input.modulesPerString;

  const minModulesForMpptMin = Math.ceil(input.inverterMpptMinVdc / hotVmpPerModule);
  const maxModulesForVocMax = Math.floor(input.inverterMaxVdc / coldVocPerModule);

  let valid = true;
  let reason: SolarStringInvalidReason | undefined;
  if (stringVocCold > input.inverterMaxVdc) {
    valid = false;
    reason = "voc_exceeds_inverter_max";
  } else if (stringVmpHot < input.inverterMpptMinVdc) {
    valid = false;
    reason = "vmp_below_mppt_min";
  } else if (stringVmpHot > input.inverterMpptMaxVdc) {
    valid = false;
    reason = "vmp_above_mppt_max";
  }

  return {
    valid,
    reason,
    coldVocPerModule: Number(coldVocPerModule.toFixed(4)),
    hotVmpPerModule: Number(hotVmpPerModule.toFixed(4)),
    stringVocCold: Number(stringVocCold.toFixed(4)),
    stringVmpHot: Number(stringVmpHot.toFixed(4)),
    minModulesForMpptMin,
    maxModulesForVocMax,
  };
}
