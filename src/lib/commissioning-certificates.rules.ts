// P-097 — Commissioning certificate rules (pure, unit-tested).
import { z } from "zod";

export const CERT_TYPES = ["mechanical_completion", "cod", "ccc_transfer"] as const;
export type CertificateType = (typeof CERT_TYPES)[number];

export const CERT_STATUSES = ["draft", "pending_signatures", "signed", "void"] as const;
export type CertificateStatus = (typeof CERT_STATUSES)[number];

export const CERT_PARTIES = ["contractor", "client", "utility"] as const;
export type CertParty = (typeof CERT_PARTIES)[number];

export const CERT_PARTY_LABELS: Record<CertParty, string> = {
  contractor: "Contractor / EPC",
  client: "Client / Owner",
  utility: "Utility",
};

export const CERT_TYPE_LABELS: Record<CertificateType, string> = {
  mechanical_completion: "Mechanical Completion",
  cod: "Commercial Operation Date",
  ccc_transfer: "Care, Custody & Control",
};

export const CERT_PREFIX: Record<CertificateType, string> = {
  mechanical_completion: "MC",
  cod: "COD",
  ccc_transfer: "CCC",
};

export const REQUIRED_PARTIES: Record<CertificateType, readonly CertParty[]> = {
  mechanical_completion: ["contractor", "client"],
  cod: ["contractor", "client", "utility"],
  ccc_transfer: ["contractor", "client"],
};

export interface CertSignature {
  party: CertParty;
  name: string;
  title: string;
  signed_at: string;
  file_path: string;
}

export function missingCertParties(
  type: CertificateType,
  signatures: readonly CertSignature[],
): CertParty[] {
  const have = new Set(signatures.map((s) => s.party));
  return REQUIRED_PARTIES[type].filter((p) => !have.has(p));
}

export function allSigned(type: CertificateType, signatures: readonly CertSignature[]): boolean {
  return missingCertParties(type, signatures).length === 0;
}

/**
 * Suggest the next certificate number for a type given the existing numbers
 * already used within the same company. Zero-padded to 4 digits.
 * Ignores numbers that don't match the standard prefix pattern.
 */
export function suggestCertNumber(
  type: CertificateType,
  existingNumbers: readonly string[],
): string {
  const prefix = CERT_PREFIX[type];
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const n of existingNumbers) {
    const m = re.exec(n.trim());
    if (m) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export function isPassingPr(
  measured: number | null | undefined,
  contract: number | null | undefined,
): boolean {
  if (measured == null || contract == null) return false;
  if (!Number.isFinite(measured) || !Number.isFinite(contract)) return false;
  return measured >= contract;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const listCertsInput = z.object({
  projectId: z.string().uuid(),
});

export const issueCertInput = z.object({
  projectId: z.string().uuid(),
  type: z.enum(CERT_TYPES),
  effectiveDate: z.string().min(4).max(20),
  scopeNotes: z.string().max(4000).optional().default(""),
  certificateNumber: z.string().min(2).max(80),
});

export const addSignatureInput = z.object({
  certificateId: z.string().uuid(),
  party: z.enum(CERT_PARTIES),
  name: z.string().min(2).max(200),
  title: z.string().min(1).max(200),
  filePath: z.string().min(1).max(500),
});

export const attachPdfInput = z.object({
  certificateId: z.string().uuid(),
  filePath: z.string().min(1).max(500),
});
