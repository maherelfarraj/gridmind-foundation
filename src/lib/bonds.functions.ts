// P-202 — Bonds & guarantees server functions. Thin wrapper module:
// imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  BondIdSchema,
  BondReasonSchema,
  ClaimIdSchema,
  CreateBondSchema,
  CreateClaimSchema,
  OPEN_CLAIM_STATUSES,
  RELEASABLE_STATUSES,
  RENEWABLE_STATUSES,
  RenewBondSchema,
  RETURNABLE_STATUSES,
  ResolveClaimSchema,
  TERMINAL_CLAIM_STATUSES,
  isTerminalBondStatus,
  paidTotal,
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
  insertClaim,
  insertRenewal,
  latestReleaseApproval,
  loadBond,
  loadClaim,
  loadClaims,
  loadContracts,
  loadCurrencies,
  loadProjectNames,
  loadRenewals,
  loadTimeline,
  outstandingClaimCount,
  patchBond,
  queryBonds,
  startBondRelease,
  updateClaim,
  setBondDocument,
  setBondStatus,
  type ClaimRow,
  type ReleaseApproval,
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
  release_approval: ReleaseApproval | null;
}

export const getBondInstrument = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<BondDetailResult> => {
    requireSupabaseAuth(context);
    const instrument = await loadBond(context, data.instrument_id);
    const [claims, renewals, can_write, release_approval] = await Promise.all([
      loadClaims(context, instrument.id),
      loadRenewals(context, instrument.id),
      canWriteBonds(context),
      latestReleaseApproval(context, instrument.id),
    ]);
    const timeline = await loadTimeline(context, instrument.id, renewals, claims);
    let document_url: string | null = null;
    if (instrument.document_path) {
      const { data: signed } = await context.supabase.storage
        .from(BONDS_BUCKET)
        .createSignedUrl(instrument.document_path, 600);
      document_url = signed?.signedUrl ?? null;
    }
    const renewalsWithDocs = await Promise.all(
      renewals.map(async (r) => {
        if (!r.document_path) return { ...r, document_url: null };
        const { data: signed } = await context.supabase.storage
          .from(BONDS_BUCKET)
          .createSignedUrl(r.document_path, 600);
        return { ...r, document_url: signed?.signedUrl ?? null };
      }),
    );
    return {
      instrument,
      claims,
      renewals: renewalsWithDocs,
      timeline,
      document_url,
      can_write,
      activation_blockers: activationBlockers(instrument),
      release_approval,
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

// ---------------------------------------------------------------------------
// P-204 — claims workflow
// ---------------------------------------------------------------------------

export const createBondClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => CreateClaimSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; claim_id: string }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const companyId = await bondsCompanyId(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (data.amount > instrument.amount) {
      httpError(422, "claim_exceeds_instrument", "Claim exceeds instrument amount.", {
        instrument_amount: instrument.amount,
      });
    }
    const claims = await loadClaims(context, instrument.id);
    if (claims.some((c) => OPEN_CLAIM_STATUSES.includes(c.status as never))) {
      httpError(409, "claim_already_open", "An open claim already exists on this instrument.");
    }
    const claim = await insertClaim(context, companyId, data);
    await audit(context, "bond.claim_created", "bond_claims", claim.id, {
      claim_id: claim.id,
      instrument_id: instrument.id,
      amount: data.amount,
    });
    return { ok: true, claim_id: claim.id };
  });

export const submitBondClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ClaimIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const claim = await loadClaim(context, data.claim_id);
    if (claim.status !== "draft") {
      httpError(409, "invalid_transition", "Only a draft claim can be submitted.");
    }
    const instrument = await loadBond(context, claim.instrument_id);
    await updateClaim(context, claim.id, {
      status: "submitted",
      submitted_by: context.user!.id,
    });
    // Only flag the instrument as claimed when no release approval is pending.
    const approval = await latestReleaseApproval(context, instrument.id);
    const releasePending = approval?.status === "pending";
    if (!releasePending && !isTerminalBondStatus(instrument.status)) {
      await setBondStatus(context, instrument.id, "claimed");
    }
    await audit(context, "bond.claim_submitted", "bond_claims", claim.id, {
      claim_id: claim.id,
      instrument_id: instrument.id,
      amount: claim.amount,
      before: { status: claim.status },
      after: { status: "submitted" },
    });
    return { ok: true };
  });

export const resolveBondClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ResolveClaimSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const claim = await loadClaim(context, data.claim_id);
    if (!OPEN_CLAIM_STATUSES.includes(claim.status as never)) {
      httpError(409, "invalid_transition", "This claim is already resolved.");
    }
    const instrument = await loadBond(context, claim.instrument_id);
    if (data.outcome === "paid") {
      const claims = await loadClaims(context, instrument.id);
      const already = paidTotal(claims.filter((c) => c.id !== claim.id));
      if (already + claim.amount > instrument.amount) {
        httpError(
          422,
          "paid_exceeds_instrument",
          "Paid claims would exceed the instrument amount.",
          {
            instrument_amount: instrument.amount,
            paid_total: already,
          },
        );
      }
    }
    const terminal = TERMINAL_CLAIM_STATUSES.includes(data.outcome as never);
    await updateClaim(context, claim.id, {
      status: data.outcome,
      resolution_notes: data.resolution_notes ?? null,
      resolved_at: terminal ? new Date().toISOString() : null,
    });
    await audit(context, "bond.claim_resolved", "bond_claims", claim.id, {
      claim_id: claim.id,
      instrument_id: instrument.id,
      before: { status: claim.status },
      after: { status: data.outcome },
      resolution_notes: data.resolution_notes ?? null,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// P-204 — release / return / cancel
// ---------------------------------------------------------------------------

export const requestBondRelease = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondReasonSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; instance_id: string }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (isTerminalBondStatus(instrument.status)) {
      httpError(409, "terminal_status", "This instrument is closed; no further transitions.");
    }
    if (!RELEASABLE_STATUSES.includes(instrument.effective_status)) {
      httpError(409, "invalid_transition", "Only live or lapsed instruments can be released.");
    }
    const existing = await latestReleaseApproval(context, instrument.id);
    if (existing?.status === "pending") {
      httpError(409, "release_pending", "A release approval is already pending.");
    }
    const instanceId = await startBondRelease(
      context,
      instrument.id,
      instrument.amount,
      data.reason,
    );
    if (!instanceId) {
      // No silent self-approval for legal-financial instruments.
      httpError(409, "no_release_rule", "Release requires the bond_release approval rule.");
    }
    await audit(context, "bond.release_requested", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      approval_instance_id: instanceId,
      reason: data.reason,
    });
    return { ok: true, instance_id: instanceId as string };
  });

export const applyBondReleaseDecision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondIdSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; outcome: "pending" | "released" | "rejected" | "none" }> => {
      requireSupabaseAuth(context);
      await assertBondWrite(context);
      const instrument = await loadBond(context, data.instrument_id);
      const approval = await latestReleaseApproval(context, instrument.id);
      if (!approval) return { ok: true, outcome: "none" };
      if (approval.status === "pending") return { ok: true, outcome: "pending" };
      if (approval.status === "rejected") {
        await audit(context, "bond.release_rejected", "bond_instruments", instrument.id, {
          instrument_id: instrument.id,
          approval_instance_id: approval.id,
          before: { status: instrument.status },
          after: { status: instrument.status },
        });
        return { ok: true, outcome: "rejected" };
      }
      if (approval.status !== "approved") return { ok: true, outcome: "none" };
      if (instrument.status === "released") return { ok: true, outcome: "released" };
      if (isTerminalBondStatus(instrument.status)) {
        httpError(409, "terminal_status", "This instrument is closed; no further transitions.");
      }
      const reason = approval.reason ?? "Released after approval.";
      await patchBond(context, instrument.id, {
        status: "released",
        released_at: new Date().toISOString(),
        released_by: context.user!.id,
        status_reason: reason,
      });
      await audit(context, "bond.released", "bond_instruments", instrument.id, {
        instrument_id: instrument.id,
        approval_instance_id: approval.id,
        before: { status: instrument.status },
        after: { status: "released", status_reason: reason },
      });
      return { ok: true, outcome: "released" };
    },
  );

export const returnBondInstrument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondReasonSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (instrument.instrument_type !== "bid_bond") {
      httpError(409, "not_a_bid_bond", "Only bid bonds can be returned.");
    }
    if (isTerminalBondStatus(instrument.status)) {
      httpError(409, "terminal_status", "This instrument is closed; no further transitions.");
    }
    if (
      !RETURNABLE_STATUSES.includes(
        instrument.effective_status === "expiring_soon" ? "active" : instrument.effective_status,
      )
    ) {
      httpError(409, "invalid_transition", "Only live or lapsed bid bonds can be returned.");
    }
    await patchBond(context, instrument.id, {
      status: "returned",
      status_reason: data.reason,
    });
    await audit(context, "bond.returned", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      before: { status: instrument.status },
      after: { status: "returned", status_reason: data.reason },
    });
    return { ok: true };
  });

export const cancelBondInstrument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BondReasonSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (isTerminalBondStatus(instrument.status)) {
      httpError(409, "terminal_status", "This instrument is closed; no further transitions.");
    }
    await patchBond(context, instrument.id, {
      status: "cancelled",
      status_reason: data.reason,
    });
    await audit(context, "bond.cancelled", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      before: { status: instrument.status },
      after: { status: "cancelled", status_reason: data.reason },
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// P-205 — renewal
// ---------------------------------------------------------------------------

export const renewBondInstrument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => RenewBondSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const companyId = await bondsCompanyId(context);
    const instrument = await loadBond(context, data.instrument_id);
    if (isTerminalBondStatus(instrument.status)) {
      httpError(409, "terminal_status", "This instrument is closed; no further transitions.");
    }
    if (!RENEWABLE_STATUSES.includes(instrument.effective_status)) {
      httpError(409, "invalid_transition", "Only live or lapsed instruments can be renewed.");
    }
    if (instrument.expiry_date && data.new_expiry <= instrument.expiry_date) {
      httpError(422, "expiry_not_forward", "New expiry must be after the current expiry", {
        current_expiry: instrument.expiry_date,
      });
    }
    await insertRenewal(context, companyId, {
      instrument_id: instrument.id,
      previous_expiry: instrument.expiry_date,
      new_expiry: data.new_expiry,
      premium_amount: data.premium_amount,
      document_path: data.document_path,
      notes: data.notes,
    });
    const patch: Record<string, unknown> = {
      expiry_date: data.new_expiry,
      status: "active",
    };
    if (data.document_path) patch.document_path = data.document_path;
    await patchBond(context, instrument.id, patch);
    await audit(context, "bond.renewed", "bond_instruments", instrument.id, {
      instrument_id: instrument.id,
      previous_expiry: instrument.expiry_date,
      new_expiry: data.new_expiry,
      premium_amount: data.premium_amount ?? null,
      before: { status: instrument.status, expiry_date: instrument.expiry_date },
      after: { status: "active", expiry_date: data.new_expiry },
    });
    return { ok: true };
  });

/** Uploads a renewal document without attaching it to the instrument yet. */
export const uploadBondRenewalDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => UploadBondDocSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; path: string }> => {
    requireSupabaseAuth(context);
    await assertBondWrite(context);
    const companyId = await bondsCompanyId(context);
    const instrument = await loadBond(context, data.instrument_id);
    const path = bondDocumentPath(
      companyId,
      instrument.id,
      `${Date.now()}-${data.filename}`,
    );
    const { error } = await context.supabase.storage
      .from(BONDS_BUCKET)
      .upload(path, decodeBase64(data.content_base64), {
        contentType: data.content_type || "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
    return { ok: true, path };
  });
