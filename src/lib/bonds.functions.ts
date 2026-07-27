// P-202 — Bonds & guarantees server functions. Thin wrapper module:
// imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  BondIdSchema,
  CreateBondSchema,
  ListBondsSchema,
  UploadBondDocSchema,
  activationBlockers,
  bondDocumentPath,
  computeKpis,
  instrumentTypeLabel,
  type BondKpis,
  type BondRow,
} from "@/lib/bonds.rules";
import {
  BONDS_BUCKET,
  assertBondWrite,
  bondsCompanyId,
  canWriteBonds,
  decodeBase64,
  insertBond,
  loadBond,
  loadClaims,
  loadContracts,
  loadCurrencies,
  loadProjectNames,
  loadRenewals,
  loadTimeline,
  outstandingClaimCount,
  queryBonds,
  setBondDocument,
  setBondStatus,
  type ClaimRow,
  type RenewalRow,
  type TimelineEvent,
} from "@/lib/bonds.server";
import { toCsv } from "@/lib/csv";
import { assertExportAllowed } from "@/lib/export-guard";
import { audit, httpError } from "@/lib/payments.server";

export interface BondsRegisterResult {
  rows: BondRow[];
  kpis: BondKpis;
  can_write: boolean;
  projects: { id: string; name: string }[];
  currencies: string[];
  contracts: { id: string; label: string; project_id: string | null }[];
}

export const getBondsRegister = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListBondsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<BondsRegisterResult> => {
    requireSupabaseAuth(context);
    const [rows, claims, can_write, projectNames, currencies, contracts] = await Promise.all([
      queryBonds(context, data),
      outstandingClaimCount(context),
      canWriteBonds(context),
      loadProjectNames(context),
      loadCurrencies(context),
      loadContracts(context),
    ]);
    return {
      rows,
      kpis: computeKpis(rows, claims),
      can_write,
      projects: [...projectNames.entries()].map(([id, name]) => ({ id, name })),
      currencies,
      contracts,
    };
  });

export interface BondDetailResult {
  instrument: BondRow;
  claims: ClaimRow[];
  renewals: RenewalRow[];
  timeline: TimelineEvent[];
  document_url: string | null;
  can_write: boolean;
  activation_blockers: string[];
}

export const getBondInstrument = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<BondDetailResult> => {
    requireSupabaseAuth(context);
    const instrument = await loadBond(context, data.instrument_id);
    const [claims, renewals, can_write] = await Promise.all([
      loadClaims(context, instrument.id),
      loadRenewals(context, instrument.id),
      canWriteBonds(context),
    ]);
    const timeline = await loadTimeline(context, instrument.id, renewals, claims);
    let document_url: string | null = null;
    if (instrument.document_path) {
      const { data: signed } = await context.supabase.storage
        .from(BONDS_BUCKET)
        .createSignedUrl(instrument.document_path, 600);
      document_url = signed?.signedUrl ?? null;
    }
    return {
      instrument,
      claims,
      renewals,
      timeline,
      document_url,
      can_write,
      activation_blockers: activationBlockers(instrument),
    };
  });

export const createBondInstrument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => CreateBondSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; instrument: BondRow }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const companyId = await bondsCompanyId(context);
    const instrument = await insertBond(context, companyId, data);
    await audit(context, "bond.issued", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      type: instrument.instrument_type,
      amount: instrument.amount,
    });
    return { ok: true, instrument };
  });

export const activateBondInstrument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (instrument.status !== "draft") {
      httpError(409, "invalid_transition", "Only a draft instrument can be activated.");
    }
    const blockers = activationBlockers(instrument);
    if (blockers.length > 0) {
      httpError(409, "activation_blocked", "This instrument is not ready to activate.", {
        blockers,
      });
    }
    await setBondStatus(context, instrument.id, "active");
    await audit(context, "bond.activated", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      before: { status: instrument.status },
      after: { status: "active" },
    });
    return { ok: true };
  });

export const uploadBondDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => UploadBondDocSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; path: string }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const companyId = await bondsCompanyId(context);
    const instrument = await loadBond(context, data.instrument_id);
    // FIRST path segment MUST be the company UUID — storage RLS enforces this.
    const path = bondDocumentPath(companyId, instrument.id, data.filename);
    const { error } = await context.supabase.storage
      .from(BONDS_BUCKET)
      .upload(path, decodeBase64(data.content_base64), {
        contentType: data.content_type || "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
    await setBondDocument(context, instrument.id, path);
    await audit(context, "bond.document_uploaded", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      path,
    });
    return { ok: true, path };
  });

export const exportBondsCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListBondsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ csv: string; filename: string }> => {
    requireSupabaseAuth(context);
    await assertExportAllowed(context.supabase as never, data.project_id ?? null, "csv");
    const rows = await queryBonds(context, data);
    const csv = toCsv(
      [
        "instrument_number",
        "type",
        "beneficiary",
        "issuer",
        "principal",
        "project",
        "amount",
        "currency_code",
        "issue_date",
        "expiry_date",
        "days_to_expiry",
        "status",
      ],
      rows.map((r) => [
        r.instrument_number,
        instrumentTypeLabel(r.instrument_type),
        r.beneficiary_name,
        r.issuer_name,
        r.principal_name ?? "",
        r.project_name ?? "",
        r.amount.toFixed(2),
        r.currency_code,
        r.issue_date ?? "",
        r.expiry_date ?? "",
        r.days_to_expiry === null ? "" : String(r.days_to_expiry),
        r.effective_status,
      ]),
    );
    return { csv, filename: `bonds-register-${new Date().toISOString().slice(0, 10)}.csv` };
  });
