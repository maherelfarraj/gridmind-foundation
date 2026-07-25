// P-096 — Pure rules for commissioning punch closure.
// Kept separate from server module to avoid tss-serverfn-split issues.
import { z } from "zod";

export const SIGNOFF_PARTIES = ["contractor", "client", "utility"] as const;
export type SignoffParty = (typeof SIGNOFF_PARTIES)[number];

export const SIGNOFF_PARTY_LABELS: Record<SignoffParty, string> = {
  contractor: "Contractor",
  client: "Client",
  utility: "Utility",
};

export const PUNCH_CATEGORY_SEMANTICS: Record<
  "A" | "B" | "C",
  { label: string; requires: string; tone: string }
> = {
  A: {
    label: "A — Blocker",
    requires: "Must be closed before COD / energization.",
    tone: "destructive",
  },
  B: {
    label: "B — Handover",
    requires: "Must be closed before project handover.",
    tone: "warning",
  },
  C: {
    label: "C — Minor",
    requires:
      "May carry into Operations with a dated action plan.",
    tone: "muted",
  },
};

export const closePunchInput = z.object({
  punchItemId: z.string().uuid(),
  party: z.enum(SIGNOFF_PARTIES),
  signerName: z.string().trim().min(2).max(200),
  evidencePath: z.string().trim().min(1).max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type ClosePunchInput = z.infer<typeof closePunchInput>;

export const listPunchInput = z.object({
  projectId: z.string().uuid(),
});
export type ListPunchInput = z.infer<typeof listPunchInput>;

export const assertNoOpenAInput = z.object({
  projectId: z.string().uuid(),
});
export type AssertNoOpenAInput = z.infer<typeof assertNoOpenAInput>;

const CLOSE_ROLES = new Set([
  "construction_admin",
  "foreman",
  "project_admin",
  "company_admin",
]);
export function canClosePunch(roles: readonly string[]): boolean {
  return roles.some((r) => CLOSE_ROLES.has(r));
}

const READ_ROLES = new Set([
  "construction_admin",
  "foreman",
  "project_admin",
  "om_admin",
  "company_admin",
  "engineer",
  "field_technician",
  "client_viewer",
]);
export function canReadPunchBoard(roles: readonly string[]): boolean {
  return roles.some((r) => READ_ROLES.has(r));
}

/** Parties required to close a punch item given its category + utility flag. */
export function requiredParties(
  category: "A" | "B" | "C",
  utilityWitnessRequired: boolean,
): SignoffParty[] {
  const req: SignoffParty[] = ["contractor"];
  if (category === "A") req.push("client");
  if (utilityWitnessRequired) req.push("utility");
  return req;
}

/** Parties from `required` that are not present in `have`. */
export function missingParties(
  required: readonly SignoffParty[],
  have: readonly SignoffParty[],
): SignoffParty[] {
  const set = new Set(have);
  return required.filter((p) => !set.has(p));
}

export function canCloseNow(
  category: "A" | "B" | "C",
  utilityWitnessRequired: boolean,
  parties: readonly SignoffParty[],
): boolean {
  return missingParties(
    requiredParties(category, utilityWitnessRequired),
    parties,
  ).length === 0;
}
