// P-183 — Quality-management server functions. Thin wrappers only: helpers
// live in quality.server.ts / quality.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, currentCompanyId, hasAnyRole, httpError } from "@/lib/cwp.server";
import {
  cableTestSchema,
  calibrationSchema,
  canSignOffStep,
  certificateSchema,
  dossierCreateSchema,
  dossierIssueSchema,
  dossierSectionsSchema,
  fatSchema,
  isDossierComplete,
  itpCreateSchema,
  itpStepSchema,
  itpStepSignoffSchema,
  itpUpdateSchema,
  mirSchema,
  mirUpdateSchema,
  relayTestSchema,
  satSchema,
  testResultPatchSchema,
  thermographicSchema,
  torqueSchema,
  transformerTestSchema,
  weldingSchema,
} from "@/lib/quality.rules";
import {
  assertDossierSectionsResolve,
  assertToolCalibrated,
  auditQa,
  insertQaRow,
  insertTestRecord,
  latestCalibration,
  listQaRows,
  QA_DOC_WRITER_ROLES,
  QA_TEST_WRITER_ROLES,
} from "@/lib/quality.server";

const projectInput = (raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw);

/* ------------------------------- access ---------------------------------- */

export const getQualityAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return {
      canWritePlans: await hasAnyRole(context.supabase, QA_DOC_WRITER_ROLES),
      canWriteRecords: await hasAnyRole(context.supabase, QA_TEST_WRITER_ROLES),
    };
  });

/* --------------------------------- ITPs ----------------------------------- */

export const listItps = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listQaRows(context.supabase, "inspection_test_plans", "project_id", data.projectId);
  });

export const listItpSteps = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ itpId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("itp_steps")
      .select("*")
      .eq("itp_id", data.itpId)
      .order("seq", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

export const createItp = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => itpCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; itp_number: string }>(
      context.supabase,
      "inspection_test_plans",
      "itp_number",
      "ITP",
      companyId,
      (itp_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        itp_number,
        title: data.title,
        discipline: data.discipline,
        cwp_id: data.cwpId ?? null,
        wbs_item_id: data.wbsItemId ?? null,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "itp.created", "inspection_test_plans", row.id, {
      itp_number: row.itp_number,
      project_id: data.projectId,
    });
    return row;
  });

export const updateItp = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => itpUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.discipline !== undefined) patch.discipline = data.discipline;
    if (data.cwpId !== undefined) patch.cwp_id = data.cwpId;
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const { data: row, error } = await context.supabase
      .from("inspection_test_plans")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await auditQa(context.supabase, "itp.updated", "inspection_test_plans", data.id, patch);
    return row;
  });

export const addItpStep = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => itpStepSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(context.supabase, "itp_steps", {
      company_id: companyId,
      itp_id: data.itpId,
      seq: data.seq,
      description: data.description,
      point_type: data.pointType,
      reference_doc: data.referenceDoc ?? null,
      signoff_role: data.signoffRole ?? null,
    });
    await auditQa(context.supabase, "itp_step.created", "itp_steps", row.id, {
      itp_id: data.itpId,
      seq: data.seq,
      point_type: data.pointType,
    });
    return row;
  });

export const signOffItpStep = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => itpStepSignoffSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: step, error: stepError } = await context.supabase
      .from("itp_steps")
      .select("id,itp_id,seq,point_type,signoff_role")
      .eq("id", data.stepId)
      .maybeSingle();
    if (stepError) throw stepError;
    if (!step) httpError(404, "not_found");
    const candidateRoles = [
      ...new Set([
        ...QA_TEST_WRITER_ROLES,
        ...QA_DOC_WRITER_ROLES,
        (step as { signoff_role: string | null }).signoff_role ?? "",
      ]),
    ].filter(Boolean);
    const held: string[] = [];
    for (const role of candidateRoles) {
      if (await hasAnyRole(context.supabase, [role])) held.push(role);
    }
    if (!canSignOffStep((step as { signoff_role: string | null }).signoff_role, held))
      httpError(403, "forbidden_role", "This hold point requires its designated sign-off role.");

    const { data: row, error } = await context.supabase
      .from("itp_steps")
      .update({
        status: data.status,
        signed_off_by: data.status === "failed" ? null : context.user!.id,
        signed_off_at: data.status === "failed" ? null : new Date().toISOString(),
      } as never)
      .eq("id", data.stepId)
      .select("*")
      .single();
    if (error) throw error;
    await auditQa(context.supabase, "itp_step.signed_off", "itp_steps", data.stepId, {
      status: data.status,
      note: data.note ?? null,
    });
    return row;
  });

/* --------------------------------- MIRs ----------------------------------- */

export const listMirs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listQaRows(
      context.supabase,
      "material_inspection_requests",
      "project_id",
      data.projectId,
    );
  });

export const createMir = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => mirSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; mir_number: string }>(
      context.supabase,
      "material_inspection_requests",
      "mir_number",
      "MIR",
      companyId,
      (mir_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        mir_number,
        material: data.material,
        purchase_order_id: data.purchaseOrderId ?? null,
        qty: data.qty ?? null,
        uom: data.uom ?? null,
        inspection_date: data.inspectionDate ?? null,
        notes: data.notes ?? null,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "mir.created", "material_inspection_requests", row.id, {
      mir_number: row.mir_number,
    });
    return row;
  });

export const updateMir = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => mirUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.result !== undefined) patch.result = data.result;
    if (data.inspectionDate !== undefined) patch.inspection_date = data.inspectionDate;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const { data: row, error } = await context.supabase
      .from("material_inspection_requests")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await auditQa(context.supabase, "mir.updated", "material_inspection_requests", data.id, patch);
    return row;
  });

/* ------------------------------- FAT / SAT -------------------------------- */

export const listFatSat = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const [fat, sat] = await Promise.all([
      listQaRows(context.supabase, "factory_acceptance_tests", "project_id", data.projectId),
      listQaRows(context.supabase, "site_acceptance_tests", "project_id", data.projectId),
    ]);
    return { fat, sat };
  });

export const createFat = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => fatSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; fat_number: string }>(
      context.supabase,
      "factory_acceptance_tests",
      "fat_number",
      "FAT",
      companyId,
      (fat_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        fat_number,
        equipment_tag: data.equipmentTag,
        purchase_order_id: data.purchaseOrderId ?? null,
        test_date: data.testDate ?? null,
        location: data.location ?? null,
        result: data.result,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "fat.created", "factory_acceptance_tests", row.id, {
      fat_number: row.fat_number,
    });
    return row;
  });

export const createSat = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => satSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; sat_number: string }>(
      context.supabase,
      "site_acceptance_tests",
      "sat_number",
      "SAT",
      companyId,
      (sat_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        sat_number,
        equipment_tag: data.equipmentTag,
        fat_id: data.fatId ?? null,
        test_date: data.testDate ?? null,
        result: data.result,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "sat.created", "site_acceptance_tests", row.id, {
      sat_number: row.sat_number,
    });
    return row;
  });

export const setAcceptanceResult = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => testResultPatchSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const table = data.kind === "fat" ? "factory_acceptance_tests" : "site_acceptance_tests";
    const { error } = await context.supabase
      .from(table)
      .update({ result: data.result } as never)
      .eq("id", data.id);
    if (error) throw error;
    await auditQa(context.supabase, `${data.kind}.result_set`, table, data.id, {
      result: data.result,
    });
    return { ok: true };
  });

/* ----------------------------- certificates ------------------------------- */

export const listCertificates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listQaRows(context.supabase, "test_certificates", "project_id", data.projectId);
  });

export const createCertificate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => certificateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; cert_number: string }>(
      context.supabase,
      "test_certificates",
      "cert_number",
      "CERT",
      companyId,
      (cert_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        cert_number,
        entity_type: data.entityType,
        entity_id: data.entityId ?? null,
        title: data.title,
        issued_by: data.issuedBy ?? null,
        issue_date: data.issueDate ?? null,
        expiry_date: data.expiryDate ?? null,
        file_path: data.filePath ?? null,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "certificate.created", "test_certificates", row.id, {
      cert_number: row.cert_number,
      entity_type: data.entityType,
    });
    return row;
  });

/* ------------------------------ calibration -------------------------------- */

export const listCalibrations = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    return listQaRows(context.supabase, "calibration_records", "company_id", companyId, "cal_date");
  });

export const createCalibration = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => calibrationSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(context.supabase, "calibration_records", {
      company_id: companyId,
      instrument_tag: data.instrumentTag,
      instrument: data.instrument,
      calibrated_by: data.calibratedBy ?? null,
      cal_date: data.calDate,
      next_due: data.nextDue ?? null,
      result: data.result,
      certificate_path: data.certificatePath ?? null,
      created_by: context.user!.id,
    });
    await auditQa(context.supabase, "calibration.created", "calibration_records", row.id, {
      instrument_tag: data.instrumentTag,
      cal_date: data.calDate,
    });
    return row;
  });

/* --------------------------- discipline records ---------------------------- */

export const listTestRecords = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const tables = [
      "welding_records",
      "torque_records",
      "cable_test_results",
      "thermographic_inspections",
      "relay_testing",
      "transformer_test_results",
    ] as const;
    const [welding, torque, cable, thermographic, relay, transformer] = await Promise.all(
      tables.map((t) => listQaRows(context.supabase, t, "project_id", data.projectId)),
    );
    return { welding, torque, cable, thermographic, relay, transformer };
  });

export const createWeldingRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => weldingSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const seed = `W-${data.weldDate.replace(/-/g, "")}-${Date.now().toString(36).toUpperCase()}`;
    const row = await insertTestRecord<{ id: string }>(context.supabase, "welding_records", {
      company_id: companyId,
      project_id: data.projectId,
      weld_number: seed,
      welder_name: data.welderName,
      welder_cert: data.welderCert ?? null,
      wps_ref: data.wpsRef ?? null,
      weld_date: data.weldDate,
      area: data.area ?? null,
      ndt_method: data.ndtMethod ?? null,
      result: data.result,
      created_by: context.user!.id,
    });
    await auditQa(context.supabase, "welding.created", "welding_records", row.id, {
      weld_number: seed,
    });
    return row;
  });

export const createTorqueRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => torqueSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    await assertToolCalibrated(context.supabase, companyId, data.toolTag, data.torqueDate);
    const row = await insertTestRecord<{ id: string }>(context.supabase, "torque_records", {
      company_id: companyId,
      project_id: data.projectId,
      equipment_tag: data.equipmentTag,
      bolt_ref: data.boltRef,
      target_torque_nm: data.targetTorqueNm,
      actual_torque_nm: data.actualTorqueNm ?? null,
      tool_tag: data.toolTag ?? null,
      torque_date: data.torqueDate,
      result: data.result,
      created_by: context.user!.id,
    });
    await auditQa(context.supabase, "torque.created", "torque_records", row.id, {
      equipment_tag: data.equipmentTag,
      bolt_ref: data.boltRef,
      tool_tag: data.toolTag ?? null,
    });
    return row;
  });

export const createCableTest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => cableTestSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(context.supabase, "cable_test_results", {
      company_id: companyId,
      project_id: data.projectId,
      cable_tag: data.cableTag,
      test_type: data.testType,
      values: data.values,
      test_date: data.testDate,
      result: data.result,
      created_by: context.user!.id,
    });
    await auditQa(context.supabase, "cable_test.created", "cable_test_results", row.id, {
      cable_tag: data.cableTag,
      test_type: data.testType,
    });
    return row;
  });

export const createThermographicInspection = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => thermographicSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(
      context.supabase,
      "thermographic_inspections",
      {
        company_id: companyId,
        project_id: data.projectId,
        equipment_tag: data.equipmentTag,
        location: data.location ?? null,
        image_path: data.imagePath ?? null,
        max_temp_c: data.maxTempC ?? null,
        delta_t_c: data.deltaTC ?? null,
        finding: data.finding ?? null,
        inspection_date: data.inspectionDate,
        result: data.result,
        created_by: context.user!.id,
      },
    );
    await auditQa(context.supabase, "thermography.created", "thermographic_inspections", row.id, {
      equipment_tag: data.equipmentTag,
    });
    return row;
  });

export const createRelayTest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => relayTestSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(context.supabase, "relay_testing", {
      company_id: companyId,
      project_id: data.projectId,
      relay_tag: data.relayTag,
      test_type: data.testType,
      settings: data.settings,
      test_date: data.testDate,
      result: data.result,
      created_by: context.user!.id,
    });
    await auditQa(context.supabase, "relay_test.created", "relay_testing", row.id, {
      relay_tag: data.relayTag,
      test_type: data.testType,
    });
    return row;
  });

export const createTransformerTest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => transformerTestSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_TEST_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertTestRecord<{ id: string }>(
      context.supabase,
      "transformer_test_results",
      {
        company_id: companyId,
        project_id: data.projectId,
        transformer_tag: data.transformerTag,
        test_type: data.testType,
        values: data.values,
        test_date: data.testDate,
        result: data.result,
        created_by: context.user!.id,
      },
    );
    await auditQa(
      context.supabase,
      "transformer_test.created",
      "transformer_test_results",
      row.id,
      {
        transformer_tag: data.transformerTag,
        test_type: data.testType,
      },
    );
    return row;
  });

export const getToolCalibration = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ toolTag: z.string().trim().min(1) }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    return latestCalibration(context.supabase, companyId, data.toolTag);
  });

/* ------------------------------- dossiers ---------------------------------- */

export const listDossiers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectInput)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listQaRows(context.supabase, "commissioning_dossiers", "project_id", data.projectId);
  });

export const createDossier = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dossierCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertQaRow<{ id: string; dossier_number: string }>(
      context.supabase,
      "commissioning_dossiers",
      "dossier_number",
      "DOSS",
      companyId,
      (dossier_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        dossier_number,
        title: data.title,
        created_by: context.user!.id,
      }),
    );
    await auditQa(context.supabase, "dossier.created", "commissioning_dossiers", row.id, {
      dossier_number: row.dossier_number,
    });
    return row;
  });

export const setDossierSections = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dossierSectionsSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    await assertDossierSectionsResolve(context.supabase, data.sections);
    const { data: row, error } = await context.supabase
      .from("commissioning_dossiers")
      .update({
        sections: data.sections as never,
        status: isDossierComplete(data.sections) ? "complete" : "compiling",
      } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await auditQa(context.supabase, "dossier.sections_set", "commissioning_dossiers", data.id, {
      section_count: data.sections.length,
    });
    return row;
  });

export const issueDossier = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dossierIssueSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, QA_DOC_WRITER_ROLES);
    const { data: current, error: loadError } = await context.supabase
      .from("commissioning_dossiers")
      .select("id,sections")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!current) httpError(404, "not_found");
    const sections = ((current as { sections: unknown }).sections ?? []) as Array<{
      key: string;
      label: string;
      entity_type: string;
      entity_ids: string[];
    }>;
    if (!isDossierComplete(sections))
      httpError(
        422,
        "dossier_incomplete",
        "Every dossier section must reference at least one record.",
      );
    await assertDossierSectionsResolve(context.supabase, sections);
    const issuedAt = new Date().toISOString();
    const { data: row, error } = await context.supabase
      .from("commissioning_dossiers")
      .update({ status: "issued", issued_at: issuedAt } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await auditQa(context.supabase, "dossier.issued", "commissioning_dossiers", data.id, {
      issued_at: issuedAt,
    });
    return row;
  });
