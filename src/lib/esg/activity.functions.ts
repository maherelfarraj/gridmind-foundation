// P-216 — ESG activity register server functions. Thin wrappers only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, audit, currentCompanyId, hasAnyRole, httpError } from "@/lib/cwp.server";
import {
  activityListSchema,
  csvFingerprint,
  csvRowSchema,
  equipmentFuelFingerprint,
  manualActivitySchema,
  updateActivitySchema,
  wasteFingerprint,
  WASTE_TYPE_TO_CATEGORY,
} from "@/lib/esg/activity.rules";
import {
  aggregateEquipmentFuel,
  enteredByNames,
  ESG_WRITER_ROLES,
  existingFingerprints,
  importAvailability,
  insertActivities,
  loadActivities,
  loadFactors,
  loadManualActivity,
  loadWasteRows,
} from "@/lib/esg/activity.server";

const EVIDENCE_BUCKET = "documents";

export const getEsgActivityAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const [canManage, availability, companyId] = await Promise.all([
      hasAnyRole(context.supabase, ESG_WRITER_ROLES),
      importAvailability(context.supabase),
      currentCompanyId(context.supabase, context.user.id),
    ]);
    return { canManage, companyId, imports: availability };
  });

export const listEsgFactors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    return loadFactors(context.supabase, companyId);
  });

export const listEsgActivities = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => activityListSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const rows = await loadActivities(context.supabase, data.projectId, data.month);
    const names = await enteredByNames(context.supabase, rows);
    return rows.map((r) => ({
      ...r,
      entered_by_name: r.entered_by ? (names[r.entered_by] ?? null) : null,
    }));
  });

/* ------------------------------ manual entry ------------------------------ */

export const createEsgActivity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => manualActivitySchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const [row] = await insertActivities(context.supabase, [
      {
        companyId,
        projectId: data.projectId,
        month: data.month,
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        source: "manual",
        notes: data.notes ?? null,
        evidencePath: data.evidencePath ?? null,
        enteredBy: context.user.id,
      },
    ]);
    await audit(context.supabase, "esg.activity_recorded", "esg_activities", row.id, {
      source: "manual",
      act_number: row.act_number,
      category: row.category,
      quantity: row.quantity,
      unit: row.unit,
      project_id: data.projectId,
      period_month: row.period_month,
    });
    return row;
  });

export const updateEsgActivity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => updateActivitySchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const before = await loadManualActivity(context.supabase, data.id);
    const { data: updated, error } = await context.supabase
      .from("esg_activities")
      .update({
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        notes: data.notes ?? null,
        evidence_path: data.evidencePath ?? before.evidence_path,
      } as never)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "not_found", "Activity row not found");
    await audit(context.supabase, "esg.activity_updated", "esg_activities", data.id, {
      source: "manual",
      act_number: before.act_number,
      before: { category: before.category, quantity: before.quantity, unit: before.unit },
      after: { category: data.category, quantity: data.quantity, unit: data.unit },
    });
    return updated;
  });

export const deleteEsgActivity = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const before = await loadManualActivity(context.supabase, data.id);
    const { error } = await context.supabase.from("esg_activities").delete().eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, "esg.activity_deleted", "esg_activities", data.id, {
      source: "manual",
      act_number: before.act_number,
      category: before.category,
      quantity: before.quantity,
    });
    return { ok: true };
  });

/* -------------------------------- evidence -------------------------------- */

export const setEsgActivityEvidence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), path: z.string().min(1).max(512) }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    await loadManualActivity(context.supabase, data.id);
    const { error } = await context.supabase
      .from("esg_activities")
      .update({ evidence_path: data.path } as never)
      .eq("id", data.id);
    if (error) throw error;
    await audit(context.supabase, "esg.activity_evidence_attached", "esg_activities", data.id, {
      path: data.path,
    });
    return { ok: true };
  });

export const signEsgEvidenceUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ path: z.string().min(1) }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: signed, error } = await context.supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(data.path, 600);
    if (error) httpError(404, "evidence_unavailable", error.message);
    return { url: signed?.signedUrl ?? "" };
  });

/* --------------------------------- imports -------------------------------- */

export const importEquipmentFuel = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => activityListSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const agg = await aggregateEquipmentFuel(context.supabase, data.projectId, data.month);
    if (!agg.available) {
      httpError(409, "source_unavailable", "Equipment records are not available in this workspace");
    }
    const fingerprint = equipmentFuelFingerprint(data.projectId, data.month);
    const seen = await existingFingerprints(context.supabase, data.projectId, data.month);
    let created = 0;
    let skipped = 0;
    if (agg.litres <= 0) {
      skipped = 1;
    } else if (seen.has(fingerprint)) {
      skipped = 1;
    } else {
      const factors = await loadFactors(context.supabase, companyId);
      await insertActivities(context.supabase, [
        {
          companyId,
          projectId: data.projectId,
          month: data.month,
          category: "fuel_diesel",
          quantity: agg.litres,
          unit: factors.fuel_diesel?.unit ?? "L",
          source: "equipment_fuel",
          notes: `Aggregated from ${agg.recordCount} equipment records`,
          fingerprint,
          enteredBy: context.user.id,
        },
      ]);
      created = 1;
    }
    await audit(context.supabase, "esg.activity_recorded", "esg_activities", null as never, {
      source: "equipment_fuel",
      created,
      skipped,
      project_id: data.projectId,
      month: data.month,
    });
    return { created, skipped };
  });

export const importWasteActivities = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => activityListSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const source = await loadWasteRows(context.supabase, data.projectId, data.month);
    if (!source.available) {
      httpError(409, "source_unavailable", "Waste tracking is not available in this workspace");
    }
    const seen = await existingFingerprints(context.supabase, data.projectId, data.month);
    const pending = [] as Parameters<typeof insertActivities>[1];
    let skipped = 0;
    for (const row of source.rows) {
      const category = WASTE_TYPE_TO_CATEGORY[row.waste_type] ?? "waste_general";
      const fingerprint = wasteFingerprint(row.id);
      if (seen.has(fingerprint) || Number(row.qty) <= 0) {
        skipped += 1;
        continue;
      }
      pending.push({
        companyId,
        projectId: data.projectId,
        month: data.month,
        category,
        quantity: Number(row.qty),
        unit: row.uom || "kg",
        source: "waste",
        sourceId: row.id,
        fingerprint,
        enteredBy: context.user.id,
      });
    }
    const inserted = await insertActivities(context.supabase, pending);
    await audit(context.supabase, "esg.activity_recorded", "esg_activities", null as never, {
      source: "waste",
      created: inserted.length,
      skipped,
      project_id: data.projectId,
      month: data.month,
    });
    return { created: inserted.length, skipped };
  });

export const importActivityCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        rows: z
          .array(csvRowSchema.extend({ hash: z.string().min(4).max(32) }))
          .min(1)
          .max(500),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const seenByMonth = new Map<string, Set<string>>();
    const pending = [] as Parameters<typeof insertActivities>[1];
    let skipped = 0;
    for (const row of data.rows) {
      let seen = seenByMonth.get(row.month);
      if (!seen) {
        seen = await existingFingerprints(context.supabase, data.projectId, row.month);
        seenByMonth.set(row.month, seen);
      }
      const fingerprint = csvFingerprint(data.projectId, row.month, row.category, row.hash);
      if (seen.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      seen.add(fingerprint);
      pending.push({
        companyId,
        projectId: data.projectId,
        month: row.month,
        category: row.category,
        quantity: row.quantity,
        unit: row.unit,
        source: "import",
        fingerprint,
        enteredBy: context.user.id,
      });
    }
    const inserted = await insertActivities(context.supabase, pending);
    await audit(context.supabase, "esg.activity_recorded", "esg_activities", null as never, {
      source: "import",
      created: inserted.length,
      skipped,
      project_id: data.projectId,
    });
    return { created: inserted.length, skipped };
  });
