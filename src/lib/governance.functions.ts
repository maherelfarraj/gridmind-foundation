// P-182 — Construction governance server functions. Thin wrappers only:
// helpers live in governance.server.ts / governance.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, audit, currentCompanyId, httpError } from "@/lib/cwp.server";
import {
  attendanceSchema,
  methodStatementCreateSchema,
  methodStatementReviseSchema,
  methodStatementSubmitSchema,
  methodStatementUpdateSchema,
  nextRevision,
  permitCreateSchema,
  permitTransitionSchema,
  siteInstructionSchema,
  siteInstructionTransitionSchema,
  technicalQueryAnswerSchema,
  technicalQueryEscalateSchema,
  technicalQuerySchema,
  technicalQueryStatusSchema,
  toolboxTalkSchema,
} from "@/lib/governance.rules";
import {
  GOV_DOC_WRITER_ROLES,
  insertGovRow,
  loadGovRow,
  type PermitRow,
  PTW_WRITER_ROLES,
  startGovApproval,
  sweepPermitExpiry,
  sweepPermitList,
  TBT_WRITER_ROLES,
} from "@/lib/governance.server";

const projectInput = (raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw);

/* ------------------------------- access ---------------------------------- */

export const getGovernanceAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const probe = async (roles: readonly string[]) => {
      try {
        await assertRoles(context.supabase, roles);
        return true;
      } catch {
        return false;
      }
    };
    return {
      canWriteDocs: await probe(GOV_DOC_WRITER_ROLES),
      canWriteTalks: await probe(TBT_WRITER_ROLES),
      canWritePermits: await probe(PTW_WRITER_ROLES),
    };
  });

/* --------------------------- method statements ---------------------------- */

export const listMethodStatements = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("method_statements")
      .select("*")
      .eq("project_id", data.projectId)
      .order("ms_number", { ascending: true })
      .order("revision", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

export const createMethodStatement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => methodStatementCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertGovRow<{ id: string; ms_number: string }>(
      context.supabase,
      "method_statements",
      "ms_number",
      "MS",
      companyId,
      (ms_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        ms_number,
        title: data.title,
        activity: data.activity,
        file_path: data.filePath ?? null,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "method_statement.created", "method_statements", row.id, {
      ms_number: row.ms_number,
      project_id: data.projectId,
    });
    return row;
  });

export const updateMethodStatement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => methodStatementUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.activity !== undefined) patch.activity = data.activity;
    if (data.filePath !== undefined) patch.file_path = data.filePath ?? null;
    if (data.status !== undefined) patch.status = data.status;
    const { data: row, error } = await context.supabase
      .from("method_statements")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    await audit(context.supabase, "method_statement.updated", "method_statements", data.id, patch);
    return row;
  });

/** Revision bump: same ms_number, R0 → R1, prior revision marked superseded. */
export const reviseMethodStatement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => methodStatementReviseSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const prev = await loadGovRow<{
      id: string;
      company_id: string;
      project_id: string;
      ms_number: string;
      title: string;
      activity: string;
      revision: string;
      file_path: string | null;
    }>(context.supabase, "method_statements", data.id);

    const { data: row, error } = await context.supabase
      .from("method_statements")
      .insert({
        company_id: prev.company_id,
        project_id: prev.project_id,
        ms_number: prev.ms_number,
        title: prev.title,
        activity: prev.activity,
        revision: nextRevision(prev.revision),
        file_path: prev.file_path,
        status: "draft",
        created_by: context.user!.id,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    await context.supabase
      .from("method_statements")
      .update({ status: "superseded" } as never)
      .eq("id", prev.id);
    await audit(
      context.supabase,
      "method_statement.revised",
      "method_statements",
      (row as { id: string }).id,
      { ms_number: prev.ms_number, from_revision: prev.revision },
    );
    return row;
  });

/** Submit for approval via P-111, with inline fallback when no rule exists. */
export const submitMethodStatement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => methodStatementSubmitSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const row = await loadGovRow<{ id: string; project_id: string; ms_number: string }>(
      context.supabase,
      "method_statements",
      data.id,
    );
    const instanceId = await startGovApproval(
      context.supabase,
      "method_statement",
      "method_statement",
      row.id,
      row.project_id,
    );
    const status = instanceId ? "under_review" : "approved";
    const patch: Record<string, unknown> = { status };
    if (!instanceId) {
      patch.approved_by = context.user!.id;
      patch.approved_at = new Date().toISOString();
    }
    const { error } = await context.supabase
      .from("method_statements")
      .update(patch as never)
      .eq("id", row.id);
    if (error) throw error;
    await audit(context.supabase, "method_statement.submitted", "method_statements", row.id, {
      ms_number: row.ms_number,
      approval_instance_id: instanceId,
      inline_fallback: !instanceId,
    });
    return { status, approvalInstanceId: instanceId };
  });

/* ----------------------------- toolbox talks ------------------------------ */

export const listToolboxTalks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const [talks, attendance] = await Promise.all([
      context.supabase
        .from("toolbox_talks")
        .select("*")
        .eq("project_id", data.projectId)
        .order("talk_date", { ascending: false }),
      context.supabase.from("toolbox_talk_attendance").select("*"),
    ]);
    if (talks.error) throw talks.error;
    if (attendance.error) throw attendance.error;
    return { talks: talks.data ?? [], attendance: attendance.data ?? [] };
  });

export const upsertToolboxTalk = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => toolboxTalkSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, TBT_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const payload = {
      talk_date: data.talkDate,
      topic: data.topic,
      location: data.location ?? null,
      presenter: data.presenter ?? null,
      status: data.status,
      notes: data.notes ?? null,
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("toolbox_talks")
        .update(payload as never)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!row) httpError(404, "not_found");
      await audit(context.supabase, "toolbox_talk.updated", "toolbox_talks", data.id, payload);
      return row;
    }
    const row = await insertGovRow<{ id: string; tbt_number: string }>(
      context.supabase,
      "toolbox_talks",
      "tbt_number",
      "TBT",
      companyId,
      (tbt_number) => ({
        ...payload,
        company_id: companyId,
        project_id: data.projectId,
        tbt_number,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "toolbox_talk.created", "toolbox_talks", row.id, {
      tbt_number: row.tbt_number,
      project_id: data.projectId,
    });
    return row;
  });

export const recordAttendance = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attendanceSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, TBT_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const { data: row, error } = await context.supabase
      .from("toolbox_talk_attendance")
      .insert({
        company_id: companyId,
        talk_id: data.talkId,
        worker_name: data.workerName,
        trade: data.trade ?? null,
        employer: data.employer ?? null,
        signature_path: data.signaturePath ?? null,
        attended: data.attended,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    await audit(
      context.supabase,
      "toolbox_talk.attendance_recorded",
      "toolbox_talk_attendance",
      (row as { id: string }).id,
      { talk_id: data.talkId, worker_name: data.workerName },
    );
    return row;
  });

/* ----------------------------- permits to work ---------------------------- */

export const listPermits = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("permits_to_work")
      .select("*")
      .eq("project_id", data.projectId)
      .order("valid_from", { ascending: false });
    if (error) throw error;
    return await sweepPermitList(context.supabase, (rows ?? []) as unknown as PermitRow[]);
  });

export const createPermit = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => permitCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, PTW_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertGovRow<{ id: string; ptw_number: string }>(
      context.supabase,
      "permits_to_work",
      "ptw_number",
      "PTW",
      companyId,
      (ptw_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        ptw_number,
        permit_type: data.permitType,
        location: data.location,
        description: data.description,
        valid_from: data.validFrom,
        valid_to: data.validTo,
        isolations: data.isolations,
        requested_by: context.user!.id,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "ptw.created", "permits_to_work", row.id, {
      ptw_number: row.ptw_number,
      project_id: data.projectId,
      permit_type: data.permitType,
    });
    return row;
  });

/** Issue (activate) a permit through P-111, with inline fallback. */
export const issuePermit = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, PTW_WRITER_ROLES);
    const row = await loadGovRow<PermitRow>(context.supabase, "permits_to_work", data.id);
    const validity = await sweepPermitExpiry(context.supabase, row);
    if (validity.effectiveStatus === "expired") httpError(409, "ptw_expired", validity.reason!);
    if (!row.isolations_confirmed) {
      httpError(409, "isolations_unconfirmed", "Confirm isolations before issuing the permit.");
    }
    const instanceId = await startGovApproval(
      context.supabase,
      "permit_to_work",
      "permit_to_work",
      row.id,
      row.project_id,
    );
    const patch: Record<string, unknown> = { issued_by: context.user!.id };
    if (!instanceId) patch.status = "active";
    const { error } = await context.supabase
      .from("permits_to_work")
      .update(patch as never)
      .eq("id", row.id);
    if (error) throw error;
    await audit(context.supabase, "ptw.issued", "permits_to_work", row.id, {
      ptw_number: row.ptw_number,
      approval_instance_id: instanceId,
      inline_fallback: !instanceId,
    });
    return { status: instanceId ? row.status : "active", approvalInstanceId: instanceId };
  });

export const transitionPermit = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => permitTransitionSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, PTW_WRITER_ROLES);
    const row = await loadGovRow<PermitRow>(context.supabase, "permits_to_work", data.id);
    const validity = await sweepPermitExpiry(context.supabase, row);
    if (validity.effectiveStatus === "expired" && data.status === "active") {
      httpError(409, "ptw_expired", validity.reason!);
    }
    const patch: Record<string, unknown> = { status: data.status };
    if (data.isolationsConfirmed !== undefined) {
      patch.isolations_confirmed = data.isolationsConfirmed;
    }
    if (data.status === "closed") {
      patch.closed_by = context.user!.id;
      patch.closed_at = new Date().toISOString();
    }
    const { error } = await context.supabase
      .from("permits_to_work")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, `ptw.${data.status}`, "permits_to_work", data.id, patch);
    return { status: data.status };
  });

/* --------------------------- site instructions ---------------------------- */

export const listSiteInstructions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("site_instructions")
      .select("*")
      .eq("project_id", data.projectId)
      .order("si_number", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const createSiteInstruction = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => siteInstructionSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertGovRow<{ id: string; si_number: string }>(
      context.supabase,
      "site_instructions",
      "si_number",
      "SI",
      companyId,
      (si_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        si_number,
        instruction: data.instruction,
        issued_to: data.issuedTo,
        cwp_id: data.cwpId ?? null,
        due_date: data.dueDate ?? null,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "site_instruction.created", "site_instructions", row.id, {
      si_number: row.si_number,
      project_id: data.projectId,
    });
    return row;
  });

export const transitionSiteInstruction = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => siteInstructionTransitionSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "acknowledged") patch.acknowledged_at = now;
    if (data.status === "completed") patch.completed_at = now;
    const { error } = await context.supabase
      .from("site_instructions")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, `site_instruction.${data.status}`, "site_instructions", data.id, {
      status: data.status,
    });
    return { status: data.status };
  });

/* --------------------------- technical queries ---------------------------- */

export const listTechnicalQueries = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("technical_queries")
      .select("*")
      .eq("project_id", data.projectId)
      .order("tq_number", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const createTechnicalQuery = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => technicalQuerySchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertGovRow<{ id: string; tq_number: string }>(
      context.supabase,
      "technical_queries",
      "tq_number",
      "TQ",
      companyId,
      (tq_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        tq_number,
        subject: data.subject,
        question: data.question,
        priority: data.priority,
        due_date: data.dueDate ?? null,
        raised_by: context.user!.id,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "technical_query.created", "technical_queries", row.id, {
      tq_number: row.tq_number,
      project_id: data.projectId,
    });
    return row;
  });

export const answerTechnicalQuery = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => technicalQueryAnswerSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const { error } = await context.supabase
      .from("technical_queries")
      .update({
        response: data.response,
        status: "answered",
        answered_by: context.user!.id,
        answered_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, "technical_query.answered", "technical_queries", data.id, {});
    return { status: "answered" as const };
  });

/** Escalate a TQ into the existing RFI module by linking the RFI record. */
export const escalateTechnicalQuery = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => technicalQueryEscalateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const { error } = await context.supabase
      .from("technical_queries")
      .update({ rfi_id: data.rfiId, status: "submitted" } as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, "technical_query.escalated", "technical_queries", data.id, {
      rfi_id: data.rfiId,
    });
    return { rfiId: data.rfiId };
  });

export const setTechnicalQueryStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => technicalQueryStatusSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, GOV_DOC_WRITER_ROLES);
    const { error } = await context.supabase
      .from("technical_queries")
      .update({ status: data.status } as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, `technical_query.${data.status}`, "technical_queries", data.id, {
      status: data.status,
    });
    return { status: data.status };
  });
