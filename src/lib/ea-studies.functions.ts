// P-165 — Electrical-analysis study server functions (thin wrapper module:
// imports, erased types and exported server-function declarations only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { runCalculator, summariseWarnings } from "@/lib/ea-calc.server";
import {
  auditStudy,
  canWriteStudy,
  eaError,
  EA_REVISION_TABLE,
  EA_STUDY_COLUMNS,
  EA_TABLE,
  isUniqueViolation,
  loadApproval,
  loadProjectScope,
  loadRevisions,
  loadStudy,
  reserveStudyNumber,
  snapshotStudy,
  startStudyApproval,
  type EaStudyRow,
  type JsonValue,
} from "@/lib/ea-studies.server";
import {
  canTransition,
  EA_DISCLAIMER,
  EA_STUDY_SPECS,
  EA_STUDY_TYPES,
  isEditable,
} from "@/lib/ea/study-types";

const studyTypeSchema = z.enum(EA_STUDY_TYPES);

const assumptionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  source: z.string().trim().max(200).default(""),
});

const warningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(["info", "warning", "error", "critical"]),
  message: z.string().trim().min(1).max(500),
});

const createInput = z.object({
  projectId: z.string().uuid(),
  studyType: studyTypeSchema,
  title: z.string().trim().min(2).max(160),
  inputSheet: z.record(z.string(), z.custom<JsonValue>()).default({}),
  method: z.string().trim().max(4000).default(""),
  assumptions: z.array(assumptionSchema).max(100).default([]),
  standardsRef: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

const updateInput = z.object({
  studyId: z.string().uuid(),
  title: z.string().trim().min(2).max(160).optional(),
  inputSheet: z.record(z.string(), z.custom<JsonValue>()).optional(),
  method: z.string().trim().max(4000).optional(),
  assumptions: z.array(assumptionSchema).max(100).optional(),
  results: z.record(z.string(), z.custom<JsonValue>()).optional(),
  warnings: z.array(warningSchema).max(200).optional(),
  standardsRef: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

const saveInput = z
  .object({
    studyId: z.string().uuid().nullable().default(null),
    projectId: z.string().uuid().nullable().default(null),
    studyType: studyTypeSchema,
    title: z.string().trim().min(2).max(160).nullable().default(null),
    inputSheet: z.unknown(),
    standardsRef: z.array(z.string().trim().min(1).max(120)).max(20).nullable().default(null),
  })
  .transform((v) => ({
    ...v,
    studyId: v.studyId ?? undefined,
    projectId: v.projectId ?? undefined,
    title: v.title ?? undefined,
    standardsRef: v.standardsRef ?? undefined,
  }));

const studyIdInput = z.object({ studyId: z.string().uuid() });

const listInput = z.object({
  projectId: z.string().uuid(),
  studyType: studyTypeSchema.nullable().default(null),
  status: z.enum(["draft", "under_review", "approved"]).nullable().default(null),
});

const reviseInput = z.object({
  studyId: z.string().uuid(),
  changeSummary: z.string().trim().min(1).max(500),
});

/** Study list for a project, newest first. */
export const listEaStudies = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    let query = context.supabase
      .from(EA_TABLE)
      .select(EA_STUDY_COLUMNS)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (data.studyType) query = query.eq("study_type", data.studyType);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw error;
    return {
      disclaimer: EA_DISCLAIMER,
      studies: (rows ?? []) as unknown as EaStudyRow[],
    };
  });

/** Full record: study, revision history and live approval progress. */
export const getEaStudy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => studyIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudy(context, data.studyId);
    const [revisions, approval] = await Promise.all([
      loadRevisions(context, study.id),
      loadApproval(context, study.id),
    ]);
    return {
      study,
      revisions,
      approval,
      editable: isEditable(study.status),
      spec: EA_STUDY_SPECS[study.study_type],
      disclaimer: EA_DISCLAIMER,
    };
  });

/**
 * Creates revision 0 in draft with a server-generated EA-#### number.
 * `unique (company_id, study_number)` guards concurrent callers: on conflict we
 * recompute the sequence once and retry.
 */
export const createEaStudy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    if (!(await canWriteStudy(context, project.company_id))) {
      eaError(403, "forbidden", "You cannot author electrical studies.");
    }

    const spec = EA_STUDY_SPECS[data.studyType];
    const base = {
      company_id: project.company_id,
      project_id: project.id,
      title: data.title,
      study_type: data.studyType,
      revision: 0,
      status: "draft" as const,
      input_sheet: data.inputSheet,
      assumptions: data.assumptions,
      method: data.method || spec.summary,
      results: {},
      warnings: [],
      standards_ref: data.standardsRef ?? spec.defaultStandards,
      created_by: context.user.id,
    };

    let created: EaStudyRow | null = null;
    for (let attempt = 0; attempt < 2 && !created; attempt += 1) {
      const studyNumber = await reserveStudyNumber(context, project.company_id);
      const { data: row, error } = await context.supabase
        .from(EA_TABLE)
        .insert({ ...base, study_number: studyNumber } as never)
        .select(EA_STUDY_COLUMNS)
        .single();
      if (error) {
        if (isUniqueViolation(error) && attempt === 0) continue;
        throw error;
      }
      created = row as unknown as EaStudyRow;
    }
    if (!created) eaError(409, "study_number_conflict", "Could not allocate a study number.");

    await snapshotStudy(context, created, "Initial draft");
    await auditStudy(context, "ea.study_created", created.id, {
      study_number: created.study_number,
      study_type: created.study_type,
      project_id: created.project_id,
    });
    return { study: created, disclaimer: EA_DISCLAIMER };
  });

/** Edits the draft payload. Approved studies are rejected before the trigger. */
export const updateEaStudy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudy(context, data.studyId);
    if (!(await canWriteStudy(context, study.company_id))) {
      eaError(403, "forbidden", "You cannot edit electrical studies.");
    }
    if (!isEditable(study.status)) {
      eaError(
        409,
        "ea_study_immutable",
        study.status === "approved"
          ? "Approved studies change only via a new revision."
          : "Study is under review; recall it before editing.",
      );
    }

    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.inputSheet !== undefined) patch.input_sheet = data.inputSheet;
    if (data.method !== undefined) patch.method = data.method;
    if (data.assumptions !== undefined) patch.assumptions = data.assumptions;
    if (data.results !== undefined) patch.results = data.results;
    if (data.warnings !== undefined) patch.warnings = data.warnings;
    if (data.standardsRef !== undefined) patch.standards_ref = data.standardsRef;
    if (Object.keys(patch).length === 0) return { study, disclaimer: EA_DISCLAIMER };

    const { data: row, error } = await context.supabase
      .from(EA_TABLE)
      .update(patch as never)
      .eq("id", study.id)
      .select(EA_STUDY_COLUMNS)
      .single();
    if (error) throw error;
    return { study: row as unknown as EaStudyRow, disclaimer: EA_DISCLAIMER };
  });

/** draft → under_review: snapshots the payload and opens the approval chain. */
export const submitEaStudy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => studyIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudy(context, data.studyId);
    if (!(await canWriteStudy(context, study.company_id))) {
      eaError(403, "forbidden", "You cannot submit electrical studies.");
    }
    if (!canTransition(study.status, "under_review")) {
      eaError(409, "invalid_transition", `Cannot submit a ${study.status} study.`);
    }

    const instanceId = await startStudyApproval(context, study);
    const submittedAt = new Date().toISOString();
    const { data: row, error } = await context.supabase
      .from(EA_TABLE)
      .update({
        status: "under_review",
        approval_instance_id: instanceId,
        submitted_at: submittedAt,
      } as never)
      .eq("id", study.id)
      .select(EA_STUDY_COLUMNS)
      .single();
    if (error) throw error;

    const submitted = row as unknown as EaStudyRow;
    await snapshotStudy(context, submitted, `Submitted for review (rev ${submitted.revision})`);
    await auditStudy(context, "ea.study_submitted", submitted.id, {
      study_number: submitted.study_number,
      revision: submitted.revision,
      approval_instance_id: instanceId,
    });
    return { study: submitted, approvalInstanceId: instanceId, disclaimer: EA_DISCLAIMER };
  });

/**
 * Reconciles the study with its approval instance. Called after a reviewer acts;
 * only an instance the P-111 engine marks approved flips the study to approved.
 */
export const syncEaStudyApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => studyIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudy(context, data.studyId);
    const approval = await loadApproval(context, study.id);
    if (!approval || study.status !== "under_review") {
      return { study, approval, changed: false, disclaimer: EA_DISCLAIMER };
    }

    if (approval.status === "approved") {
      const finalStep = [...approval.steps]
        .reverse()
        .find((s) => s.status === "approved" && s.decided_at);
      const approvedAt = new Date().toISOString();
      const { data: row, error } = await context.supabase
        .from(EA_TABLE)
        .update({
          status: "approved",
          approved_at: approvedAt,
          reviewer_id: finalStep?.approver_id ?? study.reviewer_id,
        } as never)
        .eq("id", study.id)
        .select(EA_STUDY_COLUMNS)
        .single();
      if (error) throw error;
      const approved = row as unknown as EaStudyRow;
      await snapshotStudy(context, approved, `Approved (rev ${approved.revision})`);
      await auditStudy(context, "ea.study_approved", approved.id, {
        study_number: approved.study_number,
        revision: approved.revision,
        reviewer_id: approved.reviewer_id,
      });
      return { study: approved, approval, changed: true, disclaimer: EA_DISCLAIMER };
    }

    if (approval.status === "rejected" || approval.status === "cancelled") {
      const { data: row, error } = await context.supabase
        .from(EA_TABLE)
        .update({ status: "draft", submitted_at: null } as never)
        .eq("id", study.id)
        .select(EA_STUDY_COLUMNS)
        .single();
      if (error) throw error;
      return {
        study: row as unknown as EaStudyRow,
        approval,
        changed: true,
        disclaimer: EA_DISCLAIMER,
      };
    }

    return { study, approval, changed: false, disclaimer: EA_DISCLAIMER };
  });

/** Approved → next revision: bumps the counter and reopens the record as draft. */
export const createEaStudyRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => reviseInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const study = await loadStudy(context, data.studyId);
    if (!(await canWriteStudy(context, study.company_id))) {
      eaError(403, "forbidden", "You cannot revise electrical studies.");
    }
    if (study.status !== "approved") {
      eaError(409, "invalid_transition", "Only an approved study starts a new revision.");
    }

    await snapshotStudy(context, study, `Baseline for revision ${study.revision + 1}`);
    const { data: row, error } = await context.supabase
      .from(EA_TABLE)
      .update({
        revision: study.revision + 1,
        status: "draft",
        approval_instance_id: null,
        submitted_at: null,
        approved_at: null,
        reviewer_id: null,
      } as never)
      .eq("id", study.id)
      .select(EA_STUDY_COLUMNS)
      .single();
    if (error) throw error;

    const revised = row as unknown as EaStudyRow;
    await auditStudy(context, "ea.revision_created", revised.id, {
      study_number: revised.study_number,
      revision: revised.revision,
      change_summary: data.changeSummary,
    });
    return { study: revised, disclaimer: EA_DISCLAIMER };
  });

/** Append-only history for the audit trail and the report appendix. */
export const listEaStudyRevisions = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => studyIdInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from(EA_REVISION_TABLE)
      .select("*")
      .eq("study_id", data.studyId)
      .order("revision", { ascending: false });
    if (error) throw error;
    return { revisions: rows ?? [], disclaimer: EA_DISCLAIMER };
  });

/**
 * P-166 — Runs a wave-1 calculator and persists the result on a DRAFT study.
 * The input sheet is validated against the calculator's own zod schema, the
 * METHOD string is stored verbatim, and warnings/assumptions travel with the
 * result so a reviewer can reproduce the run.
 */
export const saveEaStudy = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const run = runCalculator(data.studyType, data.inputSheet);
    const spec = EA_STUDY_SPECS[data.studyType];

    let study: EaStudyRow;
    if (data.studyId) {
      study = await loadStudy(context, data.studyId);
      if (!(await canWriteStudy(context, study.company_id))) {
        eaError(403, "forbidden", "You cannot edit electrical studies.");
      }
      if (study.study_type !== data.studyType) {
        eaError(409, "study_type_mismatch", "The study type cannot change after creation.");
      }
      if (!isEditable(study.status)) {
        eaError(
          409,
          "ea_study_immutable",
          study.status === "approved"
            ? "Approved studies change only via a new revision."
            : "Study is under review; recall it before recalculating.",
        );
      }
      const { data: row, error } = await context.supabase
        .from(EA_TABLE)
        .update({
          title: data.title ?? study.title,
          input_sheet: data.inputSheet as never,
          assumptions: run.assumptions as never,
          method: run.method,
          results: run.results as never,
          warnings: run.warnings as never,
          standards_ref: data.standardsRef ?? study.standards_ref,
        } as never)
        .eq("id", study.id)
        .select(EA_STUDY_COLUMNS)
        .single();
      if (error) throw error;
      study = row as unknown as EaStudyRow;
    } else {
      if (!data.projectId)
        eaError(400, "project_required", "A project is required for a new study.");
      const project = await loadProjectScope(context, data.projectId);
      if (!(await canWriteStudy(context, project.company_id))) {
        eaError(403, "forbidden", "You cannot author electrical studies.");
      }
      const base = {
        company_id: project.company_id,
        project_id: project.id,
        title: data.title ?? spec.label,
        study_type: data.studyType,
        revision: 0,
        status: "draft" as const,
        input_sheet: data.inputSheet,
        assumptions: run.assumptions,
        method: run.method,
        results: run.results,
        warnings: run.warnings,
        standards_ref: data.standardsRef ?? spec.defaultStandards,
        created_by: context.user.id,
      };
      let created: EaStudyRow | null = null;
      for (let attempt = 0; attempt < 2 && !created; attempt += 1) {
        const studyNumber = await reserveStudyNumber(context, project.company_id);
        const { data: row, error } = await context.supabase
          .from(EA_TABLE)
          .insert({ ...base, study_number: studyNumber } as never)
          .select(EA_STUDY_COLUMNS)
          .single();
        if (error) {
          if (isUniqueViolation(error) && attempt === 0) continue;
          throw error;
        }
        created = row as unknown as EaStudyRow;
      }
      if (!created) eaError(409, "study_number_conflict", "Could not allocate a study number.");
      study = created;
    }

    await auditStudy(context, "ea.study_calculated", study.id, {
      study_number: study.study_number,
      study_type: study.study_type,
      revision: study.revision,
      warning_counts: summariseWarnings(run.warnings),
    });

    return {
      study,
      method: run.method,
      warnings: run.warnings,
      assumptions: run.assumptions,
      disclaimer: EA_DISCLAIMER,
    };
  });
