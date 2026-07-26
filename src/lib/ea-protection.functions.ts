// P-168 — Protection schedule, relay settings and grid-code checklist server functions.
// Thin wrapper module: imports, erased types and exported server-function declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  auditProtection,
  buildProtectionRows,
  latestSettingRevision,
  loadDeviceScope,
  loadSldProtectionObjects,
  sldGraphAvailable,
  upsertProtectionRows,
  GC_RESPONSE_COLUMNS,
  GC_RESPONSE_TABLE,
  GC_TEMPLATE_COLUMNS,
  GC_TEMPLATE_TABLE,
  PROTECTION_COLUMNS,
  PROTECTION_TABLE,
  RELAY_COLUMNS,
  RELAY_TABLE,
} from "@/lib/ea-protection.server";
import { canWriteStudy, eaError, loadProjectScope } from "@/lib/ea-studies.server";
import {
  ANSI_FUNCTION_CODES,
  GRID_CODE_RESPONSE_STATUSES,
  NEPCO_TEMPLATE_CAVEAT,
  PROTECTION_DEVICE_TYPES,
} from "@/lib/ea/protection";
import { EA_DISCLAIMER } from "@/lib/ea/study-types";

const projectInput = z.object({ projectId: z.string().uuid() });

const generateInput = z.object({
  projectId: z.string().uuid(),
  studyId: z.string().uuid().nullable().default(null),
});

const deviceInput = z.object({
  deviceId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid(),
  studyId: z.string().uuid().nullable().default(null),
  tag: z.string().trim().min(1).max(60),
  deviceType: z.enum(PROTECTION_DEVICE_TYPES).default("circuit_breaker"),
  ansiCodes: z.array(z.string().trim().min(1).max(10)).max(30).default([]),
  voltageKv: z.number().nonnegative().nullable().default(null),
  ratedCurrentA: z.number().nonnegative().nullable().default(null),
  breakingCapacityKa: z.number().nonnegative().nullable().default(null),
  makingCapacityKa: z.number().nonnegative().nullable().default(null),
  ctRatio: z.string().trim().max(40).nullable().default(null),
  vtRatio: z.string().trim().max(40).nullable().default(null),
  curveType: z.string().trim().max(40).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

const settingRowSchema = z.object({
  settingGroup: z.number().int().min(1).max(8).default(1),
  functionCode: z.string().trim().min(1).max(10),
  pickup: z.number().nullable().default(null),
  timeDial: z.number().nullable().default(null),
  curve: z.string().trim().max(40).nullable().default(null),
  delayS: z.number().nullable().default(null),
  unit: z.string().trim().max(20).nullable().default(null),
  settings: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(1000).nullable().default(null),
});

const relayRevisionInput = z.object({
  deviceId: z.string().uuid(),
  rows: z.array(settingRowSchema).min(1).max(200),
  changeNote: z.string().trim().max(500).default(""),
});

const templateInput = z.object({
  templateId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid(),
  market: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(200),
  version: z.string().trim().min(1).max(40).default("1.0"),
  items: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20),
        category: z.string().trim().min(1).max(80),
        requirement: z.string().trim().min(1).max(2000),
        evidence_required: z.boolean().default(true),
      }),
    )
    .max(200)
    .default([]),
  isActive: z.boolean().default(true),
});

const responseInput = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  studyId: z.string().uuid().nullable().default(null),
  itemIndex: z.number().int().min(0).max(999),
  status: z.enum(GRID_CODE_RESPONSE_STATUSES),
  evidence: z.string().trim().max(2000).nullable().default(null),
  comment: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Builds the protection schedule from the Batch 16 SLD graph when it exists.
 * Falls back cleanly to `{ mode: 'manual' }` when the SLD module is absent or the
 * project has no drawings — the UI then edits the same table as a manual grid.
 */
export const generateProtectionSchedule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => generateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    if (!(await canWriteStudy(context, project.company_id))) {
      eaError(403, "forbidden", "You do not have permission to edit the protection schedule.");
    }

    const available = await sldGraphAvailable(context);
    const objects = available ? await loadSldProtectionObjects(context, data.projectId) : [];
    const rows = buildProtectionRows(objects, {
      companyId: project.company_id,
      projectId: data.projectId,
      studyId: data.studyId,
      userId: context.user.id,
    });

    const mode: "sld" | "manual" = available && rows.length > 0 ? "sld" : "manual";
    const imported = mode === "sld" ? await upsertProtectionRows(context, rows) : 0;

    await auditProtection(
      context,
      "ea.protection_schedule_generated",
      PROTECTION_TABLE,
      data.projectId,
      { mode, imported, sld_available: available, scanned_objects: objects.length },
    );

    return {
      mode,
      imported,
      sldAvailable: available,
      scannedObjects: objects.length,
      disclaimer: EA_DISCLAIMER,
    };
  });

/** Protection schedule for a project, with the ANSI picklist for the settings grid. */
export const listProtectionDevices = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: devices, error } = await context.supabase
      .from(PROTECTION_TABLE)
      .select(PROTECTION_COLUMNS)
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true })
      .order("tag", { ascending: true });
    if (error) throw error;
    return {
      devices: devices ?? [],
      ansiCodes: ANSI_FUNCTION_CODES,
      deviceTypes: PROTECTION_DEVICE_TYPES,
      disclaimer: EA_DISCLAIMER,
    };
  });

/** Manual create/edit of a schedule row (source stays 'manual' unless the SLD owns it). */
export const saveProtectionDevice = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => deviceInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    if (!(await canWriteStudy(context, project.company_id))) {
      eaError(403, "forbidden", "You do not have permission to edit the protection schedule.");
    }
    const payload = {
      company_id: project.company_id,
      project_id: data.projectId,
      study_id: data.studyId,
      tag: data.tag,
      device_type: data.deviceType,
      ansi_codes: data.ansiCodes,
      voltage_kv: data.voltageKv,
      rated_current_a: data.ratedCurrentA,
      breaking_capacity_ka: data.breakingCapacityKa,
      making_capacity_ka: data.makingCapacityKa,
      ct_ratio: data.ctRatio,
      vt_ratio: data.vtRatio,
      curve_type: data.curveType,
      notes: data.notes,
      sort_order: data.sortOrder,
    };

    if (data.deviceId) {
      const { data: updated, error } = await context.supabase
        .from(PROTECTION_TABLE)
        .update(payload as never)
        .eq("id", data.deviceId)
        .select(PROTECTION_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!updated) eaError(404, "device_not_found", "Protection device not found.");
      await auditProtection(
        context,
        "ea.protection_device_updated",
        PROTECTION_TABLE,
        data.deviceId,
        { tag: data.tag },
      );
      return { device: updated };
    }

    const { data: inserted, error } = await context.supabase
      .from(PROTECTION_TABLE)
      .insert({ ...payload, source: "manual", created_by: context.user.id } as never)
      .select(PROTECTION_COLUMNS)
      .single();
    if (error) throw error;
    await auditProtection(
      context,
      "ea.protection_device_created",
      PROTECTION_TABLE,
      (inserted as unknown as { id: string }).id,
      { tag: data.tag, source: "manual" },
    );
    return { device: inserted };
  });

/** Full relay-settings history for a device, newest revision first. */
export const listRelaySettings = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ deviceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from(RELAY_TABLE)
      .select(RELAY_COLUMNS)
      .eq("device_id", data.deviceId)
      .order("revision", { ascending: false })
      .order("setting_group", { ascending: true })
      .order("function_code", { ascending: true });
    if (error) throw error;
    const latest = await latestSettingRevision(context, data.deviceId);
    return {
      settings: rows ?? [],
      latestRevision: latest,
      ansiCodes: ANSI_FUNCTION_CODES,
      disclaimer: EA_DISCLAIMER,
    };
  });

/**
 * A settings change is always a NEW revision: the previous rows stay untouched.
 * There is no update path — the table has no UPDATE policy or grant.
 */
export const saveRelaySettingsRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => relayRevisionInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const device = await loadDeviceScope(context, data.deviceId);
    if (!(await canWriteStudy(context, device.company_id))) {
      eaError(403, "forbidden", "You do not have permission to set relay settings.");
    }

    const seen = new Set<string>();
    for (const r of data.rows) {
      const key = `${r.settingGroup}::${r.functionCode}`;
      if (seen.has(key)) {
        eaError(
          400,
          "duplicate_setting",
          `Group ${r.settingGroup} already has a row for function ${r.functionCode}.`,
        );
      }
      seen.add(key);
    }

    const previous = await latestSettingRevision(context, data.deviceId);
    const revision = previous === null ? 0 : previous + 1;
    const now = new Date().toISOString();

    const { data: inserted, error } = await context.supabase
      .from(RELAY_TABLE)
      .insert(
        data.rows.map((r) => ({
          company_id: device.company_id,
          project_id: device.project_id,
          device_id: device.id,
          revision,
          setting_group: r.settingGroup,
          function_code: r.functionCode,
          pickup: r.pickup,
          time_dial: r.timeDial,
          curve: r.curve,
          delay_s: r.delayS,
          unit: r.unit,
          settings: r.settings,
          set_by: context.user.id,
          set_at: now,
          notes: r.notes ?? (data.changeNote || null),
          created_by: context.user.id,
        })) as never,
      )
      .select(RELAY_COLUMNS);
    if (error) throw error;

    await auditProtection(context, "ea.relay_settings_revised", RELAY_TABLE, device.id, {
      device_tag: device.tag,
      revision,
      rows: data.rows.length,
      change_note: data.changeNote,
    });

    return { revision, settings: inserted ?? [] };
  });

/** Grid-code templates for the caller's company plus this project's responses. */
export const listGridCodeChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    const [{ data: templates, error: tErr }, { data: responses, error: rErr }] = await Promise.all([
      context.supabase
        .from(GC_TEMPLATE_TABLE)
        .select(GC_TEMPLATE_COLUMNS)
        .eq("company_id", project.company_id)
        .order("market", { ascending: true })
        .order("version", { ascending: true }),
      context.supabase
        .from(GC_RESPONSE_TABLE)
        .select(GC_RESPONSE_COLUMNS)
        .eq("project_id", data.projectId),
    ]);
    if (tErr) throw tErr;
    if (rErr) throw rErr;
    return {
      templates: templates ?? [],
      responses: responses ?? [],
      statuses: GRID_CODE_RESPONSE_STATUSES,
      caveat: NEPCO_TEMPLATE_CAVEAT,
      disclaimer: EA_DISCLAIMER,
    };
  });

/** Create or edit a company grid-code template (engineering_admin / company_admin). */
export const saveGridCodeTemplate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => templateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    if (!(await canWriteStudy(context, project.company_id))) {
      eaError(403, "forbidden", "You do not have permission to edit grid-code templates.");
    }
    const payload = {
      company_id: project.company_id,
      market: data.market,
      name: data.name,
      version: data.version,
      items: data.items,
      is_active: data.isActive,
    };
    if (data.templateId) {
      const { data: updated, error } = await context.supabase
        .from(GC_TEMPLATE_TABLE)
        .update(payload as never)
        .eq("id", data.templateId)
        .select(GC_TEMPLATE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!updated) eaError(404, "template_not_found", "Grid-code template not found.");
      await auditProtection(
        context,
        "ea.grid_code_template_updated",
        GC_TEMPLATE_TABLE,
        data.templateId,
        { market: data.market, version: data.version, items: data.items.length },
      );
      return { template: updated };
    }
    const { data: inserted, error } = await context.supabase
      .from(GC_TEMPLATE_TABLE)
      .insert({ ...payload, created_by: context.user.id } as never)
      .select(GC_TEMPLATE_COLUMNS)
      .single();
    if (error) throw error;
    await auditProtection(
      context,
      "ea.grid_code_template_created",
      GC_TEMPLATE_TABLE,
      (inserted as unknown as { id: string }).id,
      { market: data.market, version: data.version, items: data.items.length },
    );
    return { template: inserted };
  });

/** Upsert one checklist answer for this project. */
export const saveGridCodeResponse = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => responseInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectScope(context, data.projectId);
    if (!(await canWriteStudy(context, project.company_id))) {
      eaError(403, "forbidden", "You do not have permission to answer the grid-code checklist.");
    }
    const { data: saved, error } = await context.supabase
      .from(GC_RESPONSE_TABLE)
      .upsert(
        {
          company_id: project.company_id,
          project_id: data.projectId,
          template_id: data.templateId,
          study_id: data.studyId,
          item_index: data.itemIndex,
          status: data.status,
          evidence: data.evidence,
          comment: data.comment,
          responded_by: context.user.id,
        } as never,
        { onConflict: "template_id,project_id,item_index" },
      )
      .select(GC_RESPONSE_COLUMNS)
      .single();
    if (error) throw error;
    await auditProtection(
      context,
      "ea.grid_code_response_saved",
      GC_RESPONSE_TABLE,
      (saved as unknown as { id: string }).id,
      { item_index: data.itemIndex, status: data.status },
    );
    return { response: saved };
  });
