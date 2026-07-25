// P-089 — QA/QC pure helpers and zod schemas. No server imports so this
// module stays test-safe and can be imported from server-fn files without
// tripping the tss-serverfn-split loader.
import { z } from "zod";

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------
export const QAQC_DISCIPLINES = ["civil", "mechanical", "electrical"] as const;
export type QaqcDiscipline = (typeof QAQC_DISCIPLINES)[number];

export const QAQC_DISCIPLINE_LABELS: Record<QaqcDiscipline, string> = {
  civil: "Civil",
  mechanical: "Mechanical",
  electrical: "Electrical",
};

export const QAQC_RESULTS = ["pending", "pass", "fail", "conditional"] as const;
export type QaqcResult = (typeof QAQC_RESULTS)[number];

export const QAQC_RESULT_LABELS: Record<QaqcResult, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  conditional: "Conditional",
};

// ---------------------------------------------------------------------------
// zod
// ---------------------------------------------------------------------------
export const attachmentSchema = z.object({
  file_path: z.string().min(1),
  label: z.string().trim().max(200).nullable().optional(),
});
export type QaqcAttachment = z.infer<typeof attachmentSchema>;

export const inspectionInput = z
  .object({
    projectId: z.string().uuid(),
    discipline: z.enum(QAQC_DISCIPLINES),
    area: z.string().trim().min(1).max(200),
    itpReference: z.string().trim().max(200).nullable().optional(),
    wbsItemId: z.string().uuid().nullable().optional(),
    inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inspectorId: z.string().uuid().nullable().optional(),
    result: z.enum(QAQC_RESULTS).default("pending"),
    reworkRequired: z.boolean().default(false),
    reworkNotes: z.string().trim().max(4000).nullable().optional(),
    attachments: z.array(attachmentSchema).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.reworkRequired && !(val.reworkNotes && val.reworkNotes.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reworkNotes"],
        message: "Rework notes are required when rework is flagged.",
      });
    }
  });
export type InspectionInput = z.infer<typeof inspectionInput>;

export const inspectionUpdateInput = z
  .object({
    id: z.string().uuid(),
    discipline: z.enum(QAQC_DISCIPLINES).optional(),
    area: z.string().trim().min(1).max(200).optional(),
    itpReference: z.string().trim().max(200).nullable().optional(),
    wbsItemId: z.string().uuid().nullable().optional(),
    inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    inspectorId: z.string().uuid().nullable().optional(),
    result: z.enum(QAQC_RESULTS).optional(),
    reworkRequired: z.boolean().optional(),
    reworkNotes: z.string().trim().max(4000).nullable().optional(),
    attachments: z.array(attachmentSchema).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.reworkRequired === true &&
      !(val.reworkNotes && val.reworkNotes.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reworkNotes"],
        message: "Rework notes are required when rework is flagged.",
      });
    }
  });
export type InspectionUpdateInput = z.infer<typeof inspectionUpdateInput>;

// ---------------------------------------------------------------------------
// inspection numbers (mirrors nextIncidentNumber shape)
// ---------------------------------------------------------------------------
export function nextInspectionNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^QA-(\d+)$/i.exec(n ?? "");
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `QA-${(max + 1).toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// heatmap
// ---------------------------------------------------------------------------
export interface HeatmapRowInput {
  discipline: QaqcDiscipline;
  area: string;
  result: QaqcResult;
  rework_required: boolean;
}

export interface HeatmapCell {
  count: number;
  pass: number;
  fail: number;
  conditional: number;
  pending: number;
  rework: number;
  /** fraction 0..1 combining fails + rework relative to total */
  failRate: number;
}

export interface HeatmapSummary {
  areas: string[];
  disciplines: readonly QaqcDiscipline[];
  cells: Record<string, Record<QaqcDiscipline, HeatmapCell>>;
  totals: {
    total: number;
    pass: number;
    fail: number;
    conditional: number;
    pending: number;
    rework: number;
    reworkPct: number;
    passPct: number;
  };
}

function emptyCell(): HeatmapCell {
  return {
    count: 0,
    pass: 0,
    fail: 0,
    conditional: 0,
    pending: 0,
    rework: 0,
    failRate: 0,
  };
}

export function computeHeatmap(rows: HeatmapRowInput[]): HeatmapSummary {
  const disciplines = QAQC_DISCIPLINES;
  const areaSet = new Set<string>();
  for (const r of rows) if (r.area) areaSet.add(r.area);
  const areas = Array.from(areaSet).sort((a, b) => a.localeCompare(b));

  const cells: Record<string, Record<QaqcDiscipline, HeatmapCell>> = {};
  for (const a of areas) {
    cells[a] = {
      civil: emptyCell(),
      mechanical: emptyCell(),
      electrical: emptyCell(),
    };
  }

  let total = 0;
  let pass = 0;
  let fail = 0;
  let conditional = 0;
  let pending = 0;
  let rework = 0;

  for (const r of rows) {
    if (!cells[r.area]) continue;
    const c = cells[r.area][r.discipline];
    c.count += 1;
    total += 1;
    switch (r.result) {
      case "pass":
        c.pass += 1;
        pass += 1;
        break;
      case "fail":
        c.fail += 1;
        fail += 1;
        break;
      case "conditional":
        c.conditional += 1;
        conditional += 1;
        break;
      case "pending":
        c.pending += 1;
        pending += 1;
        break;
    }
    if (r.rework_required) {
      c.rework += 1;
      rework += 1;
    }
  }

  for (const a of areas) {
    for (const d of disciplines) {
      const c = cells[a][d];
      if (c.count === 0) continue;
      const bad = c.fail + c.rework;
      c.failRate = Math.min(1, bad / c.count);
    }
  }

  return {
    areas,
    disciplines,
    cells,
    totals: {
      total,
      pass,
      fail,
      conditional,
      pending,
      rework,
      reworkPct: total > 0 ? rework / total : 0,
      passPct: total > 0 ? pass / total : 0,
    },
  };
}

/**
 * Semantic-token background class for a heatmap cell. Uses opacity steps of
 * `bg-destructive` for scaled severity and `bg-muted` for no-data cells. No
 * raw hex — Tailwind must see these classes literally for JIT to pick them up.
 */
export function heatmapCellTint(failRate: number, count: number): string {
  if (count <= 0) return "bg-muted";
  if (failRate <= 0) return "bg-emerald-500/10 dark:bg-emerald-500/15";
  if (failRate < 0.15) return "bg-destructive/10";
  if (failRate < 0.3) return "bg-destructive/25";
  if (failRate < 0.5) return "bg-destructive/40";
  if (failRate < 0.7) return "bg-destructive/55";
  return "bg-destructive/70";
}
