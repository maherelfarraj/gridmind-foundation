// P-084 — Mobilization checklist pure helpers (unit-testable, no I/O).
export const MOBILIZATION_CATEGORIES = [
  "cabins_facilities",
  "fencing_security",
  "hse_induction",
  "utilities_comms",
  "access_logistics",
  "permits_licenses",
] as const;
export type MobilizationCategory = (typeof MOBILIZATION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MobilizationCategory, string> = {
  cabins_facilities: "Cabins & welfare",
  fencing_security: "Fencing & security",
  hse_induction: "HSE induction",
  utilities_comms: "Utilities & comms",
  access_logistics: "Access & logistics",
  permits_licenses: "Permits & licenses",
};

export const MOBILIZATION_STATUSES = ["not_started", "in_progress", "complete"] as const;
export type MobilizationStatus = (typeof MOBILIZATION_STATUSES)[number];

export const ITEM_STATUSES = ["not_started", "in_progress", "complete"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface RosterEntry {
  name: string;
  company: string;
  inducted_at: string; // ISO date
}

export interface ChecklistItem {
  key: string;
  label: string;
  category: MobilizationCategory;
  required: boolean;
  status: ItemStatus;
  evidence_path: string | null;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
  roster?: RosterEntry[]; // only on hse_induction roster item
}

export interface ProgressStats {
  requiredComplete: number;
  requiredTotal: number;
  totalComplete: number;
  total: number;
  allRequiredDone: boolean;
}

export function computeProgress(items: ChecklistItem[]): ProgressStats {
  const total = items.length;
  const totalComplete = items.filter((i) => i.status === "complete").length;
  const required = items.filter((i) => i.required);
  const requiredTotal = required.length;
  const requiredComplete = required.filter((i) => i.status === "complete").length;
  return {
    requiredComplete,
    requiredTotal,
    totalComplete,
    total,
    allRequiredDone: requiredTotal > 0 && requiredComplete === requiredTotal,
  };
}

export function deriveChecklistStatus(items: ChecklistItem[]): MobilizationStatus {
  if (items.length === 0) return "not_started";
  const touched = items.some((i) => i.status !== "not_started");
  if (!touched) return "not_started";
  return "in_progress"; // full 'complete' only via completeMobilizationChecklist()
}

/** Default seed spanning all six categories. */
export function defaultSeedItems(): ChecklistItem[] {
  const mk = (
    key: string,
    label: string,
    category: MobilizationCategory,
    required = true,
    extra: Partial<ChecklistItem> = {},
  ): ChecklistItem => ({
    key,
    label,
    category,
    required,
    status: "not_started",
    evidence_path: null,
    completed_by: null,
    completed_at: null,
    notes: null,
    ...extra,
  });
  return [
    mk("site_cabins", "Site cabins & welfare facilities", "cabins_facilities"),
    mk("laydown_area", "Laydown area prepared", "cabins_facilities"),
    mk("perimeter_fencing", "Perimeter fencing & gates installed", "fencing_security"),
    mk("security_lighting", "Security & site lighting operational", "fencing_security"),
    mk("hse_induction_all", "HSE induction for all site personnel", "hse_induction", true, {
      roster: [],
    }),
    mk("water_power_comms", "Water, power & comms provisioned", "utilities_comms"),
    mk("site_access_roads", "Site access roads & signage in place", "access_logistics"),
    mk("permits_licenses", "Permits & licenses on file", "permits_licenses"),
  ];
}
