// P-154 — Pure PV stringing engine: string sizing, MPPT allocation, combiners,
// DC cable sizing, MV collection and equipment counts. No React, no Supabase.
// Every violation is surfaced as a warning — nothing fails silently.

import { evaluateSolarString } from "@/lib/calculators/solar-string";

/** Copper resistivity in ohm-mm²/m at 20 °C. */
export const RHO_COPPER_20C = 0.0172;
/** Aluminium resistivity in ohm-mm²/m at 20 °C. */
export const RHO_ALUMINIUM_20C = 0.0282;
/** Default DC routing detour factor applied to the straight-line path. */
export const DEFAULT_ROUTING_FACTOR = 1.15;

export interface PointM {
  x: number;
  y: number;
}

export interface StringWarning {
  code: string;
  message: string;
  /** String labels, station labels or combiner labels the warning applies to. */
  refs: string[];
}

export interface ModuleSpec {
  id?: string | null;
  pmaxW: number;
  vocV: number;
  vmpV: number;
  iscA: number;
  impA: number;
  /** %/°C, normally negative. */
  tempCoeffVocPctPerC: number;
  tempCoeffVmpPctPerC?: number;
}

export interface InverterSpec {
  id?: string | null;
  acKw: number;
  maxDcV: number;
  mpptMinV: number;
  mpptMaxV: number;
  mpptCount: number;
  maxInputAPerMppt: number;
  /** Optional nameplate DC ceiling; defaults to 1.5 × AC. */
  maxDcKwp?: number;
}

export interface CombinerSpec {
  id?: string | null;
  inputs: number;
  maxInputA?: number;
}

export interface CableSpec {
  id?: string | null;
  crossSectionMm2: number;
  material?: "copper" | "aluminium";
  /** Conductor temperature factor applied to resistivity (1.0 = 20 °C). */
  tempFactor?: number;
  ampacityA?: number;
}

export interface TransformerSpec {
  id?: string | null;
  ratedKva: number;
  mvKv: number;
}

export interface SiteTemps {
  minTempC: number;
  maxTempC: number;
}

export interface ArrayBlockInput {
  /** Persisted layout block id, when the block came from the database. */
  blockId?: string | null;
  label: string;
  centroid: PointM;
  moduleCount: number;
}

export interface StationInput {
  label: string;
  centroid: PointM;
}

export interface StringingInput {
  module: ModuleSpec;
  inverter: InverterSpec;
  combiner: CombinerSpec;
  dcCable: CableSpec;
  mvCable?: CableSpec;
  transformer?: TransformerSpec | null;
  site: SiteTemps;
  blocks: ArrayBlockInput[];
  inverterStations: StationInput[];
  combinerStations?: StationInput[];
  transformerStations?: StationInput[];
  /** Modules wired in series per string. */
  modulesInSeries: number;
  routingFactor?: number;
  /** Inverter stations per MV feeder. Defaults to all on one feeder. */
  invertersPerFeeder?: number;
  /** Feeder ampacity used for the loading percentage. */
  feederRatingA?: number;
}

export interface SizedString {
  label: string;
  blockId: string | null;
  blockLabel: string;
  modulesInSeries: number;
  vocAtMinTempV: number;
  vmpAtMaxTempV: number;
  impA: number;
  iscA: number;
  dcPowerKwp: number;
  combinerLabel: string;
  inverterStationLabel: string;
  mpptIndex: number;
  cable: {
    cableId: string | null;
    crossSectionMm2: number;
    lengthM: number;
    voltageDropV: number;
    voltageDropPct: number;
    lossPct: number;
    lossKw: number;
    routingFactor: number;
  };
  valid: boolean;
  warnings: StringWarning[];
}

export interface MpptAllocation {
  inverterStationLabel: string;
  inverterId: string | null;
  mpptIndex: number;
  stringLabels: string[];
  dcKwpOnMppt: number;
  currentA: number;
  inverterAcKw: number;
  inverterDcKwp: number;
  dcAcRatio: number;
  loadingPct: number;
  combinerAssignment: Record<string, string[] | number>;
  warnings: StringWarning[];
}

export interface MvFeeder {
  label: string;
  stationLabels: string[];
  cableId: string | null;
  lengthM: number;
  voltageKv: number;
  currentA: number;
  loadingPct: number;
  transformerId: string | null;
  transformerStationLabel: string | null;
  transformerLoadingPct: number;
  warnings: StringWarning[];
}

export interface EquipmentCounts {
  modules: number;
  strings: number;
  combiners: number;
  inverters: number;
  transformers: number;
  dc_cable_m: number;
  mv_cable_m: number;
}

export interface StringingResult {
  strings: SizedString[];
  allocations: MpptAllocation[];
  feeders: MvFeeder[];
  counts: EquipmentCounts;
  totals: {
    dcKwp: number;
    acKw: number;
    dcAcRatio: number;
    validStrings: number;
    invalidStrings: number;
  };
  warnings: StringWarning[];
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function distance(a: PointM, b: PointM): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function resistivity(cable: CableSpec): number {
  const base = cable.material === "aluminium" ? RHO_ALUMINIUM_20C : RHO_COPPER_20C;
  return base * (cable.tempFactor ?? 1);
}

/**
 * Polyline route length block → combiner → inverter, multiplied by the
 * routing detour factor (default 1.15).
 */
export function routeLengthM(
  block: PointM,
  combiner: PointM,
  inverter: PointM,
  routingFactor = DEFAULT_ROUTING_FACTOR,
): number {
  return round((distance(block, combiner) + distance(combiner, inverter)) * routingFactor);
}

/**
 * Two-way DC voltage drop: Vdrop = 2 · L · I · rho / A.
 * `rho` is the temperature-corrected resistivity in ohm-mm²/m.
 */
export function voltageDropV(lengthM: number, currentA: number, cable: CableSpec): number {
  if (cable.crossSectionMm2 <= 0) return 0;
  return (2 * lengthM * currentA * resistivity(cable)) / cable.crossSectionMm2;
}

/** Cable copper loss in kW for a single circuit: I²R with R = 2·L·rho/A. */
export function cableLossKw(lengthM: number, currentA: number, cable: CableSpec): number {
  if (cable.crossSectionMm2 <= 0) return 0;
  const r = (2 * lengthM * resistivity(cable)) / cable.crossSectionMm2;
  return (currentA * currentA * r) / 1000;
}

/**
 * Evenly distributes `count` items over `buckets`, front-loading the
 * remainder so the imbalance between any two buckets is at most one.
 */
export function balancedSplit(count: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(count / buckets);
  const rem = count % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Converts an arranged layout into a complete DC/AC electrical design.
 * Deterministic: identical inputs always produce identical labels and numbers.
 */
export function generateStringing(input: StringingInput): StringingResult {
  const {
    module,
    inverter,
    combiner,
    dcCable,
    mvCable,
    transformer = null,
    site,
    blocks,
    inverterStations,
    combinerStations,
    transformerStations,
    modulesInSeries,
    routingFactor = DEFAULT_ROUTING_FACTOR,
    invertersPerFeeder,
    feederRatingA,
  } = input;

  const warnings: StringWarning[] = [];

  if (inverterStations.length === 0) {
    warnings.push({
      code: "no_inverter_stations",
      message: "The layout has no inverter stations — strings cannot be allocated.",
      refs: [],
    });
    return {
      strings: [],
      allocations: [],
      feeders: [],
      counts: {
        modules: 0,
        strings: 0,
        combiners: 0,
        inverters: 0,
        transformers: 0,
        dc_cable_m: 0,
        mv_cable_m: 0,
      },
      totals: { dcKwp: 0, acKw: 0, dcAcRatio: 0, validStrings: 0, invalidStrings: 0 },
      warnings,
    };
  }

  // ---- 1. String sizing (P-055 evaluation with site temperature extremes).
  const sizing = evaluateSolarString({
    moduleVoc: module.vocV,
    moduleVmp: module.vmpV,
    tempCoeffVocPctPerC: module.tempCoeffVocPctPerC,
    tempCoeffVmpPctPerC: module.tempCoeffVmpPctPerC,
    minTempC: site.minTempC,
    maxTempC: site.maxTempC,
    inverterMaxVdc: inverter.maxDcV,
    inverterMpptMinVdc: inverter.mpptMinV,
    inverterMpptMaxVdc: inverter.mpptMaxV,
    modulesPerString: modulesInSeries,
  });

  const sizingWarnings: StringWarning[] = [];
  if (!sizing.valid) {
    const detail: Record<string, string> = {
      voc_exceeds_inverter_max: `Cold Voc ${sizing.stringVocCold.toFixed(1)} V at ${site.minTempC} °C exceeds the inverter maximum of ${inverter.maxDcV} V — reduce to ${sizing.maxModulesForVocMax} modules in series.`,
      vmp_below_mppt_min: `Hot Vmp ${sizing.stringVmpHot.toFixed(1)} V at ${site.maxTempC} °C is below the MPPT minimum of ${inverter.mpptMinV} V — increase to ${sizing.minModulesForMpptMin} modules in series.`,
      vmp_above_mppt_max: `Hot Vmp ${sizing.stringVmpHot.toFixed(1)} V is above the MPPT maximum of ${inverter.mpptMaxV} V.`,
    };
    sizingWarnings.push({
      code: sizing.reason ?? "string_invalid",
      message: detail[sizing.reason ?? ""] ?? "String sizing is outside the inverter window.",
      refs: [],
    });
    warnings.push(...sizingWarnings);
  }

  // ---- 2. Strings per block, labelled STR-#### across the whole layout.
  const stringsPerBlockCounts = blocks.map((b) => Math.floor(b.moduleCount / modulesInSeries));
  blocks.forEach((b, i) => {
    const leftover = b.moduleCount - stringsPerBlockCounts[i] * modulesInSeries;
    if (leftover > 0) {
      warnings.push({
        code: "orphan_modules",
        message: `${b.label} has ${leftover} module(s) that do not complete a string of ${modulesInSeries}.`,
        refs: [b.label],
      });
    }
  });

  const totalStrings = stringsPerBlockCounts.reduce((s, n) => s + n, 0);
  if (totalStrings === 0) {
    warnings.push({
      code: "no_strings",
      message: "No complete strings could be formed from the layout blocks.",
      refs: [],
    });
  }

  // ---- 3. MPPT capacity: strings per MPPT bounded by max input current.
  const stringsPerMpptLimit = Math.max(
    1,
    Math.floor(inverter.maxInputAPerMppt / Math.max(module.iscA, 0.0001)),
  );
  const mpptSlots: { station: StationInput; mpptIndex: number }[] = [];
  for (const station of inverterStations) {
    for (let m = 1; m <= inverter.mpptCount; m += 1) {
      mpptSlots.push({ station, mpptIndex: m });
    }
  }
  const mpptCapacity = mpptSlots.length * stringsPerMpptLimit;
  const placeableStrings = Math.min(totalStrings, mpptCapacity);
  if (totalStrings > mpptCapacity) {
    warnings.push({
      code: "mppt_capacity_exceeded",
      message: `${totalStrings} strings exceed the MPPT capacity of ${mpptCapacity} (${inverterStations.length} inverters × ${inverter.mpptCount} MPPT × ${stringsPerMpptLimit} strings).`,
      refs: inverterStations.map((s) => s.label),
    });
  }

  // Equalise strings across every MPPT slot; imbalance is at most one string.
  const perSlot = balancedSplit(placeableStrings, mpptSlots.length);

  // ---- 4. Build the flat string list and assign slots and combiners.
  const combinerInputs = Math.max(1, combiner.inputs);
  const combinerCount = Math.max(1, Math.ceil(placeableStrings / combinerInputs));
  const combinerAnchors =
    combinerStations && combinerStations.length > 0 ? combinerStations : inverterStations;

  const strings: SizedString[] = [];
  const slotStrings: string[][] = mpptSlots.map(() => []);
  const combinerMap: Record<string, string[]> = {};

  let slotIndex = 0;
  let placed = 0;
  let stringSeq = 0;

  for (let bi = 0; bi < blocks.length && placed < placeableStrings; bi += 1) {
    const block = blocks[bi];
    for (let s = 0; s < stringsPerBlockCounts[bi] && placed < placeableStrings; s += 1) {
      while (slotIndex < mpptSlots.length && slotStrings[slotIndex].length >= perSlot[slotIndex]) {
        slotIndex += 1;
      }
      if (slotIndex >= mpptSlots.length) break;

      const slot = mpptSlots[slotIndex];
      stringSeq += 1;
      const label = `STR-${pad(stringSeq, 4)}`;
      const combinerIndex = Math.floor(placed / combinerInputs);
      const combinerLabel = `CB-${pad(combinerIndex + 1, 2)}`;
      const combinerPoint = combinerAnchors[combinerIndex % combinerAnchors.length].centroid;

      const lengthM = routeLengthM(
        block.centroid,
        combinerPoint,
        slot.station.centroid,
        routingFactor,
      );
      const current = module.impA;
      const drop = voltageDropV(lengthM, current, dcCable);
      const dropPct = sizing.stringVmpHot > 0 ? (drop / sizing.stringVmpHot) * 100 : 0;
      const lossKw = cableLossKw(lengthM, current, dcCable);
      const dcKwp = (modulesInSeries * module.pmaxW) / 1000;

      const stringWarnings: StringWarning[] = sizingWarnings.map((w) => ({ ...w, refs: [label] }));
      if (dropPct > 1.5) {
        stringWarnings.push({
          code: "dc_voltage_drop_high",
          message: `${label} DC voltage drop is ${dropPct.toFixed(2)}% over ${lengthM.toFixed(0)} m — above the 1.5% design target.`,
          refs: [label],
        });
      }
      if (dcCable.ampacityA != null && module.iscA * 1.25 > dcCable.ampacityA) {
        stringWarnings.push({
          code: "dc_cable_ampacity",
          message: `${label} design current ${(module.iscA * 1.25).toFixed(1)} A exceeds the ${dcCable.ampacityA} A cable ampacity.`,
          refs: [label],
        });
      }

      strings.push({
        label,
        blockId: block.blockId ?? null,
        blockLabel: block.label,
        modulesInSeries,
        vocAtMinTempV: round(sizing.stringVocCold, 2),
        vmpAtMaxTempV: round(sizing.stringVmpHot, 2),
        impA: module.impA,
        iscA: module.iscA,
        dcPowerKwp: round(dcKwp),
        combinerLabel,
        inverterStationLabel: slot.station.label,
        mpptIndex: slot.mpptIndex,
        cable: {
          cableId: dcCable.id ?? null,
          crossSectionMm2: dcCable.crossSectionMm2,
          lengthM,
          voltageDropV: round(drop),
          voltageDropPct: round(dropPct),
          lossPct: round(dcKwp > 0 ? (lossKw / dcKwp) * 100 : 0),
          lossKw: round(lossKw),
          routingFactor,
        },
        valid: sizing.valid,
        warnings: stringWarnings,
      });

      slotStrings[slotIndex].push(label);
      (combinerMap[combinerLabel] ??= []).push(label);
      placed += 1;
    }
  }

  for (const [label, members] of Object.entries(combinerMap)) {
    if (members.length > combinerInputs) {
      warnings.push({
        code: "combiner_inputs_exceeded",
        message: `${label} carries ${members.length} strings but the combiner has ${combinerInputs} inputs.`,
        refs: [label],
      });
    }
  }

  // ---- 5. MPPT allocations with inverter loading and DC/AC ratio.
  const inverterDcKwpTotals = new Map<string, number>();
  const allocations: MpptAllocation[] = mpptSlots.map((slot, i) => {
    const labels = slotStrings[i];
    const dcKwpOnMppt = round(labels.length * ((modulesInSeries * module.pmaxW) / 1000));
    const currentA = round(labels.length * module.impA, 2);
    inverterDcKwpTotals.set(
      slot.station.label,
      (inverterDcKwpTotals.get(slot.station.label) ?? 0) + dcKwpOnMppt,
    );
    const allocWarnings: StringWarning[] = [];
    if (labels.length > stringsPerMpptLimit) {
      allocWarnings.push({
        code: "mppt_current_exceeded",
        message: `${slot.station.label} MPPT ${slot.mpptIndex} carries ${labels.length} strings (${currentA} A), above the ${inverter.maxInputAPerMppt} A input limit.`,
        refs: [slot.station.label],
      });
    }
    return {
      inverterStationLabel: slot.station.label,
      inverterId: inverter.id ?? null,
      mpptIndex: slot.mpptIndex,
      stringLabels: labels,
      dcKwpOnMppt,
      currentA,
      inverterAcKw: inverter.acKw,
      inverterDcKwp: 0,
      dcAcRatio: 0,
      loadingPct: 0,
      combinerAssignment: {},
      warnings: allocWarnings,
    };
  });

  const maxDcKwp = inverter.maxDcKwp ?? inverter.acKw * 1.5;
  for (const alloc of allocations) {
    const invDc = round(inverterDcKwpTotals.get(alloc.inverterStationLabel) ?? 0);
    alloc.inverterDcKwp = invDc;
    alloc.dcAcRatio = round(inverter.acKw > 0 ? invDc / inverter.acKw : 0);
    alloc.loadingPct = round(inverter.acKw > 0 ? (invDc / inverter.acKw) * 100 : 0, 2);
    const own: Record<string, string[]> = {};
    for (const [cb, members] of Object.entries(combinerMap)) {
      const mine = members.filter((m) => alloc.stringLabels.includes(m));
      if (mine.length > 0) own[cb] = mine;
    }
    alloc.combinerAssignment = { ...own, inputs_per_combiner: combinerInputs };
    if (invDc > maxDcKwp) {
      alloc.warnings.push({
        code: "inverter_dc_overload",
        message: `${alloc.inverterStationLabel} carries ${invDc.toFixed(1)} kWp DC, above the ${maxDcKwp.toFixed(1)} kWp inverter DC limit.`,
        refs: [alloc.inverterStationLabel],
      });
    }
  }

  // ---- 6. MV collection: feeders group inverter stations onto transformers.
  const perFeeder = Math.max(1, invertersPerFeeder ?? inverterStations.length);
  const feeders: MvFeeder[] = [];
  const mv = mvCable ?? { crossSectionMm2: 240, material: "aluminium" as const };
  const mvKv = transformer?.mvKv ?? 33;
  const txStations = transformerStations ?? [];

  for (let f = 0; f * perFeeder < inverterStations.length; f += 1) {
    const group = inverterStations.slice(f * perFeeder, (f + 1) * perFeeder);
    const tx = txStations.length > 0 ? txStations[f % txStations.length] : null;
    const anchor = tx?.centroid ?? group[0].centroid;
    const lengthM = round(
      group.reduce((sum, st) => sum + distance(st.centroid, anchor), 0) * routingFactor,
    );
    const feederKw = group.reduce((sum, st) => sum + (inverterDcKwpTotals.get(st.label) ?? 0), 0);
    const acKw = Math.min(feederKw, group.length * inverter.acKw);
    const currentA = round(mvKv > 0 ? acKw / (Math.sqrt(3) * mvKv) : 0, 2);
    const rating = feederRatingA ?? mv.ampacityA ?? 400;
    const txLoading =
      transformer && transformer.ratedKva > 0 ? round((acKw / transformer.ratedKva) * 100, 2) : 0;

    const feederWarnings: StringWarning[] = [];
    if (rating > 0 && currentA > rating) {
      feederWarnings.push({
        code: "mv_feeder_overloaded",
        message: `Feeder F-${pad(f + 1, 2)} draws ${currentA} A, above the ${rating} A feeder rating.`,
        refs: group.map((g) => g.label),
      });
    }
    if (txLoading > 100) {
      feederWarnings.push({
        code: "transformer_overloaded",
        message: `Transformer on feeder F-${pad(f + 1, 2)} is loaded to ${txLoading}%.`,
        refs: [tx?.label ?? "TX-01"],
      });
    }
    if (!transformer) {
      feederWarnings.push({
        code: "no_transformer_selected",
        message: `Feeder F-${pad(f + 1, 2)} has no transformer selected — loading was not evaluated.`,
        refs: group.map((g) => g.label),
      });
    }

    feeders.push({
      label: `F-${pad(f + 1, 2)}`,
      stationLabels: group.map((g) => g.label),
      cableId: mv.id ?? null,
      lengthM,
      voltageKv: mvKv,
      currentA,
      loadingPct: round(rating > 0 ? (currentA / rating) * 100 : 0, 2),
      transformerId: transformer?.id ?? null,
      transformerStationLabel: tx?.label ?? null,
      transformerLoadingPct: txLoading,
      warnings: feederWarnings,
    });
  }

  // ---- 7. Equipment counts, BOM-compatible.
  const counts: EquipmentCounts = {
    modules: strings.length * modulesInSeries,
    strings: strings.length,
    combiners: strings.length > 0 ? combinerCount : 0,
    inverters: inverterStations.length,
    transformers: transformer ? Math.max(1, feeders.length) : 0,
    dc_cable_m: round(
      strings.reduce((s, st) => s + st.cable.lengthM, 0),
      1,
    ),
    mv_cable_m: round(
      feeders.reduce((s, fd) => s + fd.lengthM, 0),
      1,
    ),
  };

  const dcKwp = round(strings.reduce((s, st) => s + st.dcPowerKwp, 0));
  const acKw = round(inverterStations.length * inverter.acKw, 2);

  return {
    strings,
    allocations,
    feeders,
    counts,
    totals: {
      dcKwp,
      acKw,
      dcAcRatio: round(acKw > 0 ? dcKwp / acKw : 0),
      validStrings: strings.filter((s) => s.valid).length,
      invalidStrings: strings.filter((s) => !s.valid).length,
    },
    warnings: [
      ...warnings,
      ...allocations.flatMap((a) => a.warnings),
      ...feeders.flatMap((f) => f.warnings),
    ],
  };
}
