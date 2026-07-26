// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-168 — Arc-flash DATA PREPARATION worksheet. This module deliberately performs NO
// incident-energy calculation: it audits the completeness of the data an IEEE 1584 study
// would need and returns a gap list.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const ARC_FLASH_DISCLAIMER =
  "Data preparation only — not a certified arc-flash study. No incident energy, boundary or PPE " +
  "category is computed here. A qualified professional engineer must perform the IEEE 1584 study.";

export const ARC_FLASH_METHOD =
  "Each equipment row is checked against the IEEE 1584 input set: enclosure type, system voltage, " +
  "bolted three-phase fault current (linked from the short-circuit study where available), electrode " +
  "gap, working distance and a traceable protective-device clearing time. Rows are scored complete or " +
  "incomplete and every missing field is listed as a gap. " +
  ARC_FLASH_DISCLAIMER;

export const ARC_FLASH_ENCLOSURES = [
  "vcb",
  "vcbb",
  "hcb",
  "voa",
  "hoa",
  "cable_junction",
  "unknown",
] as const;

export const CLEARING_TIME_SOURCES = [
  "relay_setting_approved",
  "relay_setting_draft",
  "manufacturer_curve",
  "assumed",
  "unknown",
] as const;

export const arcFlashInputSchema = z.object({
  equipment: z
    .array(
      z.object({
        tag: z.string().min(1),
        equipmentType: z.string().default("switchgear"),
        voltageV: z.number().positive().nullable().default(null),
        boltedFaultKa: z.number().positive().nullable().default(null),
        boltedFaultSource: z.enum(["short_circuit_study", "manual", "unknown"]).default("unknown"),
        shortCircuitStudyId: z.string().nullable().default(null),
        workingDistanceMm: z.number().positive().nullable().default(null),
        gapMm: z.number().positive().nullable().default(null),
        enclosure: z.enum(ARC_FLASH_ENCLOSURES).default("unknown"),
        clearingTimeS: z.number().positive().nullable().default(null),
        clearingTimeSource: z.enum(CLEARING_TIME_SOURCES).default("unknown"),
        grounded: z.boolean().nullable().default(null),
        notes: z.string().default(""),
      }),
    )
    .min(1),
});

export type ArcFlashInput = z.infer<typeof arcFlashInputSchema>;
export type ArcFlashEquipment = ArcFlashInput["equipment"][number];

export type ArcFlashGap = { tag: string; field: string; message: string };

export type ArcFlashRowReadiness = {
  tag: string;
  complete: boolean;
  missingFields: string[];
  traceableClearingTime: boolean;
};

export type ArcFlashResults = {
  disclaimer: string;
  inputSheet: ArcFlashInput;
  rows: ArcFlashRowReadiness[];
  gaps: ArcFlashGap[];
  equipmentCount: number;
  readyCount: number;
  readinessPct: number;
  readyForStudy: boolean;
};

const REQUIRED_FIELDS: Array<{ key: keyof ArcFlashEquipment; label: string }> = [
  { key: "voltageV", label: "System voltage" },
  { key: "boltedFaultKa", label: "Bolted three-phase fault current" },
  { key: "workingDistanceMm", label: "Working distance" },
  { key: "gapMm", label: "Electrode gap" },
  { key: "clearingTimeS", label: "Protective-device clearing time" },
];

export function arcFlashDataPrep(input: ArcFlashInput): CalcOutput<ArcFlashResults> {
  const warnings: CalcWarning[] = [];
  const gaps: ArcFlashGap[] = [];

  const rows: ArcFlashRowReadiness[] = input.equipment.map((eq) => {
    const missing: string[] = [];
    for (const f of REQUIRED_FIELDS) {
      if (eq[f.key] === null || eq[f.key] === undefined) {
        missing.push(f.label);
        gaps.push({ tag: eq.tag, field: String(f.key), message: `${f.label} is missing.` });
      }
    }
    if (eq.enclosure === "unknown") {
      missing.push("Enclosure type");
      gaps.push({
        tag: eq.tag,
        field: "enclosure",
        message: "Enclosure type is unknown — IEEE 1584 requires an electrode configuration.",
      });
    }
    const traceableClearingTime =
      eq.clearingTimeSource === "relay_setting_approved" ||
      eq.clearingTimeSource === "manufacturer_curve";
    if (eq.clearingTimeS !== null && !traceableClearingTime) {
      gaps.push({
        tag: eq.tag,
        field: "clearingTimeSource",
        message: `Clearing time is declared as "${eq.clearingTimeSource}" — it must trace to an approved relay setting or a manufacturer curve.`,
      });
    }
    if (eq.boltedFaultKa !== null && eq.boltedFaultSource === "unknown") {
      gaps.push({
        tag: eq.tag,
        field: "boltedFaultSource",
        message:
          "Bolted fault current has no declared source — link it to the short-circuit study.",
      });
    }
    return {
      tag: eq.tag,
      complete: missing.length === 0 && traceableClearingTime,
      missingFields: missing,
      traceableClearingTime,
    };
  });

  const readyCount = rows.filter((r) => r.complete).length;
  const readinessPct = (readyCount / rows.length) * 100;

  warnings.push(warn("data_preparation_only", "info", ARC_FLASH_DISCLAIMER));
  if (readyCount < rows.length) {
    warnings.push(
      warn(
        "incomplete_arc_flash_data",
        "warning",
        `${rows.length - readyCount} of ${rows.length} equipment rows are missing data required for an IEEE 1584 study.`,
      ),
    );
  }
  const untraceable = rows.filter((r) => !r.traceableClearingTime).length;
  if (untraceable > 0) {
    warnings.push(
      warn(
        "untraceable_clearing_time",
        "warning",
        `${untraceable} row(s) have no clearing time traceable to an approved relay setting or manufacturer curve.`,
      ),
    );
  }
  const duplicates = input.equipment.map((e) => e.tag).filter((t, i, arr) => arr.indexOf(t) !== i);
  if (duplicates.length > 0) {
    warnings.push(
      warn(
        "duplicate_equipment_tag",
        "warning",
        `Duplicate equipment tags: ${[...new Set(duplicates)].join(", ")}.`,
      ),
    );
  }

  return {
    results: {
      disclaimer: ARC_FLASH_DISCLAIMER,
      inputSheet: input,
      rows,
      gaps,
      equipmentCount: rows.length,
      readyCount,
      readinessPct: round(readinessPct, 2),
      readyForStudy: readyCount === rows.length,
    },
    warnings,
    assumptionsEcho: [
      assumption("scope", "data readiness audit only", ARC_FLASH_DISCLAIMER),
      assumption("required_fields", REQUIRED_FIELDS.map((f) => f.label).join(", "), "IEEE 1584"),
    ],
  };
}
