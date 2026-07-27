// P-210 — Estimating server functions. Thin wrapper module: imports +
// createServerFn declarations only (tss-serverfn-split safe).
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { audit, httpError } from "@/lib/payments.server";
import {
  ConvertEstimateSchema,
  CreateEstimateSchema,
  DeleteEstimateLineSchema,
  DeleteRateSchema,
  EstimateIdSchema,
  ImportRateLibrarySchema,
  ListEstimatesSchema,
  MarkEstimatePricedSchema,
  SaveEstimateMarginsSchema,
  SubmitEstimateSchema,
  ReorderEstimateLinesSchema,
  UpsertEstimateLineSchema,
  UpsertRateSchema,
  lineAmount,
} from "@/lib/estimating.rules";
import { validateForPricing } from "@/lib/estimating/buildup";
import {
  assertDraft,
  assertEstimateWrite,
  assertRateWrite,
  canWriteEstimates,
  canWriteRates,
  estimatingCompanyId,
  createProposalFromEstimate,
  importBomSnapshot,
  linkEstimateToProposal,
  patchEstimate,
  startEstimateApproval,
  loadEstimate,
  loadConversionState,
  loadDecisionComment,
  loadEstimateApproval,
  loadEstimates,
  loadLines,
  loadOpportunityOptions,
  loadProjectOptions,
  loadRates,
  marginsOf,
  persistBuildup,
  loadSnapshotOptions,
  recomputeDirectCost,
  todayIso,
  type EstimateApprovalSnapshot,
  type EstimateConversionState,
  type EstimateLineRow,
  type EstimateRow,
  type OpportunityOption,
  type ProjectOption,
  type RateRowRecord,
  type SnapshotOption,
} from "@/lib/estimating.server";

export interface EstimatingRegister {
  can_write: boolean;
  estimates: EstimateRow[];
  projects: ProjectOption[];
  opportunities: OpportunityOption[];
  snapshots: SnapshotOption[];
}

export const getEstimatingRegister = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListEstimatesSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<EstimatingRegister> => {
    requireSupabaseAuth(context);
    const [estimates, projects, opportunities, snapshots, canWrite] = await Promise.all([
      loadEstimates(context, data),
      loadProjectOptions(context),
      loadOpportunityOptions(context),
      loadSnapshotOptions(context),
      canWriteEstimates(context),
    ]);
    return { can_write: canWrite, estimates, projects, opportunities, snapshots };
  });

export interface EstimateDetail {
  can_write: boolean;
  estimate: EstimateRow;
  lines: EstimateLineRow[];
  project: ProjectOption | null;
  opportunity: OpportunityOption | null;
  approval: EstimateApprovalSnapshot | null;
  conversion: EstimateConversionState;
}

export const getEstimateDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => EstimateIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<EstimateDetail> => {
    requireSupabaseAuth(context);
    const id = data.id;

    const [estimate, lines, projects, opportunities, canWrite, approval, conversion] =
      await Promise.all([
        loadEstimate(context, id),
        loadLines(context, id),
        loadProjectOptions(context),
        loadOpportunityOptions(context),
        canWriteEstimates(context),
        loadEstimateApproval(context, id),
        loadConversionState(context, id),
      ]);
    return {
      can_write: canWrite,
      estimate,
      lines,
      project: projects.find((p) => p.id === estimate.project_id) ?? null,
      opportunity: opportunities.find((o) => o.id === estimate.opportunity_id) ?? null,
      approval,
      conversion,
    };
  });


export const createEstimate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => CreateEstimateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; lines_imported: number }> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    const companyId = await estimatingCompanyId(context);
    const { data: created, error } = await context.supabase
      .from("estimates")
      .insert({
        company_id: companyId,
        project_id: data.project_id,
        opportunity_id: data.opportunity_id,
        bom_snapshot_id: data.bom_snapshot_id,
        title: data.title,
        currency_code: data.currency_code,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    const estimateId = (created as { id: string }).id;

    let imported = 0;
    if (data.bom_snapshot_id) {
      imported = await importBomSnapshot(context, {
        companyId,
        estimateId,
        snapshotId: data.bom_snapshot_id,
      });
      await recomputeDirectCost(context, estimateId);
    }
    await audit(context, "estimate.created", "estimates", estimateId, {
      estimate_id: estimateId,
      bom_snapshot_id: data.bom_snapshot_id,
      lines_imported: imported,
    });
    return { id: estimateId, lines_imported: imported };
  });

export const upsertEstimateLine = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => UpsertEstimateLineSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ direct_cost: number; line_id: string }> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    await assertDraft(context, data.estimate_id);
    const companyId = await estimatingCompanyId(context);
    const amount = lineAmount(data.qty, data.unit_rate);

    let before: EstimateLineRow | null = null;
    let lineId = data.id ?? null;

    if (lineId) {
      const existing = await loadLines(context, data.estimate_id);
      before = existing.find((l) => l.id === lineId) ?? null;
      if (!before) httpError(404, "not_found", "Line not found on this estimate.");
      const { error } = await context.supabase
        .from("estimate_lines")
        .update({
          line_type: data.line_type,
          description: data.description,
          qty: data.qty,
          uom: data.uom,
          unit_rate: data.unit_rate,
          rate_library_id: data.rate_library_id,
          notes: data.notes ?? null,
          amount,
        } as never)
        .eq("id", lineId);
      if (error) throw error;
    } else {
      const existing = await loadLines(context, data.estimate_id);
      const nextOrder = existing.reduce((max, l) => Math.max(max, l.sort_order + 1), 0);
      const { data: created, error } = await context.supabase
        .from("estimate_lines")
        .insert({
          company_id: companyId,
          estimate_id: data.estimate_id,
          line_type: data.line_type,
          description: data.description,
          qty: data.qty,
          uom: data.uom,
          unit_rate: data.unit_rate,
          rate_library_id: data.rate_library_id,
          notes: data.notes ?? null,
          amount,
          sort_order: nextOrder,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      lineId = (created as { id: string }).id;
    }

    const directCost = await recomputeDirectCost(context, data.estimate_id);
    await audit(context, "estimate.rates_updated", "estimate_lines", lineId, {
      estimate_id: data.estimate_id,
      line_id: lineId,
      before: before
        ? { qty: before.qty, unit_rate: before.unit_rate, amount: before.amount }
        : null,
      after: { qty: data.qty, unit_rate: data.unit_rate, amount },
    });
    return { direct_cost: directCost, line_id: lineId as string };
  });

export const deleteEstimateLine = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DeleteEstimateLineSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ direct_cost: number }> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    await assertDraft(context, data.estimate_id);
    const existing = await loadLines(context, data.estimate_id);
    const before = existing.find((l) => l.id === data.line_id) ?? null;
    const { error } = await context.supabase
      .from("estimate_lines")
      .delete()
      .eq("id", data.line_id)
      .eq("estimate_id", data.estimate_id);
    if (error) throw error;
    const directCost = await recomputeDirectCost(context, data.estimate_id);
    await audit(context, "estimate.rates_updated", "estimate_lines", data.line_id, {
      estimate_id: data.estimate_id,
      line_id: data.line_id,
      before: before ? { description: before.description, amount: before.amount } : null,
      after: null,
    });
    return { direct_cost: directCost };
  });

export const reorderEstimateLines = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ReorderEstimateLinesSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    await assertDraft(context, data.estimate_id);
    for (let i = 0; i < data.line_ids.length; i++) {
      const { error } = await context.supabase
        .from("estimate_lines")
        .update({ sort_order: i } as never)
        .eq("id", data.line_ids[i])
        .eq("estimate_id", data.estimate_id);
      if (error) throw error;
    }
    await audit(context, "estimate.rates_updated", "estimates", data.estimate_id, {
      estimate_id: data.estimate_id,
      line_id: null,
      before: null,
      after: { reordered: data.line_ids.length },
    });
    return { ok: true };
  });

export interface RateLibraryWorkspace {
  can_write: boolean;
  today: string;
  rates: RateRowRecord[];
}

export const getRateLibrary = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    ListEstimatesSchema.partial().parse(input && typeof input === "object" ? input : {}),
  )
  .handler(async ({ data, context }): Promise<RateLibraryWorkspace> => {
    requireSupabaseAuth(context);
    const [rates, canWrite] = await Promise.all([
      loadRates(context, { q: data.q ?? null }),
      canWriteRates(context),
    ]);
    return { can_write: canWrite, today: todayIso(), rates };
  });

export const upsertRate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => UpsertRateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await assertRateWrite(context);
    const companyId = await estimatingCompanyId(context);
    const payload = {
      company_id: companyId,
      rate_type: data.row.rate_type,
      name: data.row.name,
      uom: data.row.uom,
      unit_rate: data.row.unit_rate,
      currency_code: data.row.currency_code,
      category: data.row.category ?? null,
      supplier: data.row.supplier ?? null,
      valid_from: data.row.valid_from ?? null,
      valid_to: data.row.valid_to ?? null,
      notes: data.row.notes ?? null,
    };
    let id = data.id ?? null;
    if (id) {
      const { error } = await context.supabase
        .from("rate_library")
        .update(payload as never)
        .eq("id", id);
      if (error) throw error;
    } else {
      const { data: created, error } = await context.supabase
        .from("rate_library")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw error;
      id = (created as { id: string }).id;
    }
    await audit(context, "estimate.rates_updated", "rate_library", id, {
      rate_id: id,
      after: payload,
    });
    return { id: id as string };
  });

export const deleteRate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DeleteRateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await assertRateWrite(context);
    const { error } = await context.supabase.from("rate_library").delete().eq("id", data.id);
    if (error) throw error;
    await audit(context, "estimate.rates_updated", "rate_library", data.id, {
      rate_id: data.id,
      after: null,
    });
    return { ok: true };
  });

export const importRateLibrary = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ImportRateLibrarySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ imported: number }> => {
    requireSupabaseAuth(context);
    await assertRateWrite(context);
    const companyId = await estimatingCompanyId(context);
    const payload = data.rows.map((r) => ({
      company_id: companyId,
      rate_type: r.rate_type,
      name: r.name,
      uom: r.uom,
      unit_rate: r.unit_rate,
      currency_code: r.currency_code,
      category: r.category ?? null,
      supplier: r.supplier ?? null,
      valid_from: r.valid_from ?? null,
      valid_to: r.valid_to ?? null,
      notes: r.notes ?? null,
    }));
    const { error } = await context.supabase
      .from("rate_library")
      .upsert(payload as never, { onConflict: "company_id,rate_type,name" });
    if (error) throw error;
    await audit(context, "estimate.rates_updated", "rate_library", null, {
      imported: payload.length,
    });
    return { imported: payload.length };
  });

/* ------------------------------------------------------- build-up (P-211) */

export interface SaveMarginsResult {
  direct_cost: number;
  subtotal: number;
  total_price: number;
  warnings: string[];
}

export const saveEstimateMargins = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SaveEstimateMarginsSchema.parse(input))
  .handler(async ({ data, context }): Promise<SaveMarginsResult> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    const estimate = await assertDraft(context, data.estimate_id);
    const margins = {
      escalation_pct: data.escalation_pct,
      contingency_pct: data.contingency_pct,
      overhead_pct: data.overhead_pct,
      profit_pct: data.profit_pct,
    };
    // Server-side recompute from persisted lines — client totals are ignored.
    const { result } = await persistBuildup(context, data.estimate_id, margins);
    await audit(context, "estimate.rates_updated", "estimates", data.estimate_id, {
      estimate_id: data.estimate_id,
      before: marginsOf(estimate),
      after: margins,
      direct_cost: result.direct_cost,
      subtotal: result.subtotal,
      total_price: result.total_price,
    });
    return {
      direct_cost: result.direct_cost,
      subtotal: result.subtotal,
      total_price: result.total_price,
      warnings: result.warnings,
    };
  });

export const markEstimatePriced = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => MarkEstimatePricedSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ total_price: number; priced_at: string | null }> => {
      requireSupabaseAuth(context);
      await assertEstimateWrite(context);
      const estimate = await assertDraft(context, data.estimate_id);
      const margins = marginsOf(estimate);
      const lines = await loadLines(context, data.estimate_id);
      const check = validateForPricing(lines, margins);
      if (!check.ok) {
        httpError(422, "estimate_not_priceable", "This estimate cannot be priced yet.", {
          issues: check.issues,
          total_price: check.result.total_price,
        });
      }
      const pricedAt = new Date().toISOString();
      await persistBuildup(context, data.estimate_id, margins, {
        status: "priced",
        priced_at: pricedAt,
      });
      await audit(context, "estimate.priced", "estimates", data.estimate_id, {
        estimate_id: data.estimate_id,
        direct_cost: check.result.direct_cost,
        subtotal: check.result.subtotal,
        total_price: check.result.total_price,
      });
      return { total_price: check.result.total_price, priced_at: pricedAt };
    },
  );

/* --------------------------------------------- approval + convert (P-212) */

export interface EstimateApprovalResult {
  status: string;
  approval_instance_id: string | null;
  approval_status: string | null;
  current_step: number | null;
  comment?: string | null;
}

export const submitEstimateForReview = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SubmitEstimateSchema.parse(input))
  .handler(async ({ data, context }): Promise<EstimateApprovalResult> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    const estimate = await assertDraft(context, data.estimate_id);
    if (!(Number(estimate.total_price) > 0)) {
      httpError(422, "estimate_not_priceable", "Price the estimate before submitting it.");
    }
    const instanceId = await startEstimateApproval(context, estimate);
    if (!instanceId) {
      httpError(409, "approval_rule_missing", "Estimate approval rule is not configured.");
    }
    const submittedAt = new Date().toISOString();
    await patchEstimate(context, estimate.id, {
      status: "in_review",
      approval_instance_id: instanceId,
      submitted_at: submittedAt,
      submitted_by: context.user!.id,
      rejection_comment: null,
    });
    await audit(context, "estimate.submitted", "estimates", estimate.id, {
      estimate_id: estimate.id,
      approval_instance_id: instanceId,
      total_price: estimate.total_price,
    });
    const snapshot = await loadEstimateApproval(context, estimate.id);
    return {
      status: "in_review",
      approval_instance_id: instanceId as string,
      approval_status: snapshot?.status ?? "pending",
      current_step: snapshot?.current_step ?? 1,
    };
  });

export const checkEstimateApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SubmitEstimateSchema.parse(input))
  .handler(async ({ data, context }): Promise<EstimateApprovalResult> => {
    requireSupabaseAuth(context);
    const estimate = await loadEstimate(context, data.estimate_id);
    const snapshot = await loadEstimateApproval(context, estimate.id);
    if (!snapshot) {
      return {
        status: estimate.status,
        approval_instance_id: null,
        approval_status: null,
        current_step: null,
      };
    }

    let status: string = estimate.status;
    let comment: string | null = null;

    if (estimate.status === "in_review" && snapshot.status === "approved") {
      status = "approved";
      await patchEstimate(context, estimate.id, {
        status,
        approved_at: new Date().toISOString(),
        approved_by: context.user!.id,
      });
      await audit(context, "estimate.approved", "estimates", estimate.id, {
        estimate_id: estimate.id,
        approval_instance_id: snapshot.id,
      });
    } else if (estimate.status === "in_review" && snapshot.status === "rejected") {
      status = "draft";
      comment = await loadDecisionComment(context, snapshot.id);
      await patchEstimate(context, estimate.id, { status, rejection_comment: comment });
      await audit(context, "estimate.rejected", "estimates", estimate.id, {
        estimate_id: estimate.id,
        approval_instance_id: snapshot.id,
        comment,
      });
    }

    return {
      status,
      approval_instance_id: snapshot.id,
      approval_status: snapshot.status,
      current_step: snapshot.current_step,
      comment,
    };
  });

export const convertEstimateToProposal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ConvertEstimateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ proposal_id: string; lines: number }> => {
    requireSupabaseAuth(context);
    await assertEstimateWrite(context);
    const estimate = await loadEstimate(context, data.estimate_id);
    if (estimate.status !== "approved") {
      httpError(409, "estimate_not_approved", "Only approved estimates can be converted.");
    }
    const state = await loadConversionState(context, estimate.id);
    if (state.converted_proposal_id) {
      httpError(409, "already_converted", "This estimate has already been converted.");
    }
    const opportunityId = data.opportunity_id ?? estimate.opportunity_id;
    if (!opportunityId) {
      httpError(422, "opportunity_required", "Select an opportunity to convert into a proposal.");
    }

    const companyId = await estimatingCompanyId(context);
    const lines = await loadLines(context, estimate.id);
    const { proposalId, lineCount } = await createProposalFromEstimate(context, {
      companyId,
      estimate,
      opportunityId: opportunityId as string,
      lines,
    });

    const convertedAt = new Date().toISOString();
    await patchEstimate(context, estimate.id, {
      status: "priced",
      priced_at: estimate.priced_at ?? convertedAt,
      converted_proposal_id: proposalId,
      converted_at: convertedAt,
      converted_by: context.user!.id,
    });
    await audit(context, "estimate.converted", "estimates", estimate.id, {
      estimate_id: estimate.id,
      proposal_id: proposalId,
      total_price: estimate.total_price,
    });
    await linkEstimateToProposal(context, {
      companyId,
      projectId: estimate.project_id,
      estimateId: estimate.id,
      proposalId,
    });
    return { proposal_id: proposalId, lines: lineCount };
  });
