// P-191 — Controlled change execution server functions (thin wrapper: imports + declarations only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  closeChangeSchema,
  substitutionSchema,
  taskStatusSchema,
} from "@/lib/moc.exec.rules";
import {
  blockingChanges,
  closeChange,
  generateTasks,
  loadSubstitution,
  loadTasks,
  saveSubstitution,
  setTaskStatus,
  underChangeControl,
  writeSupersedesLinks,
} from "@/lib/moc.exec.server";
import { assertInternal, auditMoc } from "@/lib/moc.server";

export const listImplementationTasks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return { rows: await loadTasks(context, data.id) };
  });

export const generateImplementationTasks = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const created = await generateTasks(context, data.id);
    return { created, rows: await loadTasks(context, data.id) };
  });

export const updateImplementationTask = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => taskStatusSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const row = await setTaskStatus(context, data);
    await auditMoc(context, `moc.task.${data.status}`, row.change_request_id, {
      task_id: row.id,
      title: row.title,
    });
    return { row };
  });

export const closeChangeRequest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => closeChangeSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    await closeChange(context, data);
    await writeSupersedesLinks(context, data.id);
    await auditMoc(context, "moc.closed", data.id, {
      updated_documents: data.updated_documents.length,
      updated_asbuilts: data.updated_asbuilts.length,
    });
    return { ok: true };
  });

export const getChangeControlStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ entityType: z.string().trim().min(1).max(60), entityId: z.string().uuid() })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const blocked = await underChangeControl(context, data.entityType, data.entityId);
    if (!blocked) return { blocked: false, changes: [] };
    return { blocked: true, changes: await blockingChanges(context, data.entityType, data.entityId) };
  });

export const getVendorSubstitution = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return loadSubstitution(context, data.id);
  });

export const saveVendorSubstitution = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => substitutionSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    await saveSubstitution(context, {
      id: data.id,
      old_vendor_id: data.old_vendor_id ?? null,
      new_vendor_id: data.new_vendor_id ?? null,
      equivalence: data.equivalence,
    });
    await auditMoc(context, "moc.substitution_saved", data.id, {
      new_vendor_id: data.new_vendor_id ?? null,
    });
    return { ok: true };
  });
