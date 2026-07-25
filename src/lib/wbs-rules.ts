// P-072 — WBS pure rules, enums, zod schemas.
import { z } from "zod";

export const WBS_ITEM_TYPES = ["phase", "package", "discipline", "task_group"] as const;
export type WbsItemType = (typeof WBS_ITEM_TYPES)[number];

export const WBS_DISCIPLINES = [
  "civil",
  "mechanical",
  "electrical",
  "instrumentation",
  "scada",
  "hse",
  "commercial",
] as const;
export type WbsDiscipline = (typeof WBS_DISCIPLINES)[number];

export const WBS_DISCIPLINE_LABEL: Record<WbsDiscipline, string> = {
  civil: "Civil",
  mechanical: "Mechanical",
  electrical: "Electrical",
  instrumentation: "Instrumentation",
  scada: "SCADA",
  hse: "HSE",
  commercial: "Commercial",
};

export const WBS_ITEM_TYPE_LABEL: Record<WbsItemType, string> = {
  phase: "Phase",
  package: "Package",
  discipline: "Discipline",
  task_group: "Task group",
};

/** Accept "1", "1.2", "1.2.3", up to 6 segments, digits or short alnum. */
export const WBS_CODE_REGEX = /^[A-Za-z0-9]{1,6}(\.[A-Za-z0-9]{1,6}){0,5}$/;

export interface WbsNodeLite {
  id: string;
  parent_id: string | null;
  code: string;
}

/** True when `code` does NOT collide with an existing sibling. */
export function isCodeUniqueAmongSiblings(
  code: string,
  parentId: string | null,
  currentId: string | null,
  all: WbsNodeLite[],
): boolean {
  const normalized = code.trim().toLowerCase();
  return !all.some(
    (n) =>
      n.parent_id === parentId && n.id !== currentId && n.code.trim().toLowerCase() === normalized,
  );
}

/** Detect whether reparenting `id` under `newParentId` creates a cycle. */
export function wouldCreateCycle(
  all: WbsNodeLite[],
  id: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === id) return true;
  const byId = new Map(all.map((n) => [n.id, n] as const));
  // Walk from newParentId up; if we hit `id`, cycle.
  let cursor: string | null = newParentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === id) return true;
    if (guard.has(cursor)) return true;
    guard.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
  return false;
}

/** Suggest the next `1.<n>` code beneath a root child. */
export function suggestNextRootChildCode(rootCode: string, siblings: WbsNodeLite[]): string {
  const prefix = `${rootCode}.`;
  const used = new Set<number>();
  for (const s of siblings) {
    if (!s.code.startsWith(prefix)) continue;
    const tail = s.code.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && String(n) === tail) used.add(n);
  }
  let i = 1;
  while (used.has(i)) i += 1;
  return `${prefix}${i}`;
}

// ---------------------------------------------------------------------------
// zod
// ---------------------------------------------------------------------------
export const wbsItemBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(48, "Code too long")
    .regex(WBS_CODE_REGEX, "Use digits/letters, dot-separated (e.g. 1.2.3)"),
  name: z.string().trim().min(1, "Name is required").max(160),
  item_type: z.enum(WBS_ITEM_TYPES),
  discipline: z.enum(WBS_DISCIPLINES).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  budgeted_amount: z.number().min(0, "Budget must be ≥ 0").max(1e12).nullable().optional(),
  currency_code: z.string().trim().length(3).nullable().optional(),
  ifc_package_ref: z.string().trim().max(120).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const wbsCreateSchema = wbsItemBaseSchema.extend({
  projectId: z.string().uuid(),
});
export type WbsCreateInput = z.infer<typeof wbsCreateSchema>;

export const wbsUpdateSchema = z.object({
  id: z.string().uuid(),
  patch: wbsItemBaseSchema.partial(),
});
export type WbsUpdateInput = z.infer<typeof wbsUpdateSchema>;

export const wbsReparentSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const wbsImportIfcSchema = z.object({
  projectId: z.string().uuid(),
  packages: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(48).regex(WBS_CODE_REGEX, "Invalid code"),
        name: z.string().trim().min(1).max(160),
        discipline: z.enum(WBS_DISCIPLINES).nullable().optional(),
        ifc_package_ref: z.string().trim().max(120),
      }),
    )
    .min(1, "Select at least one package"),
});

export const scheduleTaskAssignSchema = z.object({
  id: z.string().uuid(),
  discipline: z.enum(WBS_DISCIPLINES).nullable(),
  wbs_item_id: z.string().uuid().nullable(),
});
