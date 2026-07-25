// P-098 — Turnover / as-built pack rules.
//
// Section labels use a plain ampersand ("O&M"), not the HTML entity.
// The PDF sanitizer normalises "&amp;" → "&" so the compiled index reads
// literally "O&M" everywhere.
import { z } from "zod";

export const TURNOVER_STATUSES = [
  "compiling",
  "ready",
  "delivered",
  "accepted",
] as const;
export type TurnoverStatus = (typeof TURNOVER_STATUSES)[number];

export const TURNOVER_SECTION_KEYS = [
  "as_builts",
  "warranties",
  "om_manual",
  "test_reports",
  "certificates",
] as const;
export type TurnoverSectionKey = (typeof TURNOVER_SECTION_KEYS)[number];

export interface TurnoverSectionItem {
  label: string;
  file_path: string;
  source: string;
  revision: string | null;
  document_date: string | null;
}

export interface TurnoverSection {
  key: TurnoverSectionKey;
  label: string;
  required: boolean;
  complete: boolean;
  items: TurnoverSectionItem[];
}

export const TURNOVER_SECTIONS: ReadonlyArray<
  Omit<TurnoverSection, "complete" | "items">
> = [
  { key: "as_builts", label: "As-built drawings", required: true },
  { key: "warranties", label: "Warranties", required: true },
  { key: "om_manual", label: "O&M manual", required: true },
  { key: "test_reports", label: "Test & commissioning reports", required: true },
  { key: "certificates", label: "Certificates", required: true },
];

export function emptySections(): TurnoverSection[] {
  return TURNOVER_SECTIONS.map((s) => ({ ...s, complete: false, items: [] }));
}

export function withComputedCompletion(
  sections: TurnoverSection[],
): TurnoverSection[] {
  return sections.map((s) => ({
    ...s,
    complete: (s.items ?? []).length >= 1,
  }));
}

export function missingRequiredSections(
  sections: TurnoverSection[],
): TurnoverSectionKey[] {
  return withComputedCompletion(sections)
    .filter((s) => s.required && !s.complete)
    .map((s) => s.key);
}

export function allRequiredComplete(sections: TurnoverSection[]): boolean {
  return missingRequiredSections(sections).length === 0;
}

// Client roles that can compile / upload / mark delivered.
export const TURNOVER_WRITE_ROLES = new Set([
  "construction_admin",
  "project_admin",
  "company_admin",
]);

// Roles that can read the workspace beyond a delivered index PDF.
export const TURNOVER_READ_ROLES = new Set([
  ...Array.from({ length: 0 }),
  "construction_admin",
  "project_admin",
  "company_admin",
  "om_admin",
  "engineer",
]);

export const turnoverProjectInput = z.object({
  projectId: z.string().uuid(),
});

export const addItemInput = z.object({
  projectId: z.string().uuid(),
  sectionKey: z.enum(["om_manual", "warranties"]),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(240),
        file_path: z.string().min(1),
        source: z.string().min(1).max(80).default("manual"),
        revision: z.string().max(40).nullable().default(null),
        document_date: z.string().max(40).nullable().default(null),
      }),
    )
    .min(1)
    .max(20),
});

export const markDeliveredInput = z.object({
  projectId: z.string().uuid(),
  acceptedBy: z.string().max(200).nullable().optional(),
});
