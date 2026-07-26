// P-150 — PV equipment library server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  PV_CATEGORIES,
  pvEquipmentSchema,
  type PvEquipmentRow,
} from "@/lib/pv-library.schemas";
import {
  auditPvLibrary,
  canWritePvLibrary,
  compactRecord,
  currentCompanyId,
  fileExtension,
  httpError,
  PV_ALLOWED_EXTENSIONS,
  PV_DOCS_BUCKET,
  pvStoragePrefix,
  sanitizeFilename,
  toPvRow,
} from "@/lib/pv-library.server";

const listInput = z.object({
  category: z.enum(PV_CATEGORIES).nullable().optional(),
  search: z.string().max(160).nullable().optional(),
  activeOnly: z.boolean().optional(),
});

export const listPvEquipment = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PvEquipmentRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("pv_equipment_library")
      .select("*")
      .order("manufacturer", { ascending: true })
      .order("model", { ascending: true });
    if (data.category) q = q.eq("category", data.category as any);
    if (data.activeOnly) q = q.eq("is_active", true);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_,]/g, "");
      if (s) q = q.or(`manufacturer.ilike.%${s}%,model.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toPvRow);
  });

export const getPvEquipment = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PvEquipmentRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("pv_equipment_library")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "equipment_not_found");
    return toPvRow(row as any);
  });

export const getPvLibraryWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await canWritePvLibrary(context) };
  });

export const savePvEquipment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => pvEquipmentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    // Duplicate guard mirrors the 0063 unique key so the UI can offer "edit existing".
    const { data: dupes, error: dupErr } = await context.supabase
      .from("pv_equipment_library")
      .select("id")
      .eq("company_id", companyId)
      .eq("category", data.category as any)
      .eq("manufacturer", data.manufacturer)
      .eq("model", data.model)
      .limit(1);
    if (dupErr) throw dupErr;
    const existingId = (dupes ?? [])[0]?.id as string | undefined;
    if (existingId && existingId !== data.id) {
      httpError(
        409,
        "duplicate_model",
        `${data.manufacturer} ${data.model} already exists in this category.`,
        { existingId },
      );
    }

    const payload = {
      company_id: companyId,
      category: data.category,
      manufacturer: data.manufacturer,
      model: data.model,
      is_active: data.is_active,
      electrical: compactRecord(data.electrical) as any,
      temp_coefficients: compactRecord(data.temp_coefficients) as any,
      degradation: compactRecord(data.degradation) as any,
      dimensions: compactRecord(data.dimensions) as any,
      limits: compactRecord(data.limits) as any,
      warranties: {
        ...compactRecord({
          product_years: data.warranties?.product_years,
          performance_years: data.warranties?.performance_years,
        }),
        performance_terms: data.warranties?.performance_terms ?? [],
      } as any,
      certifications: (data.certifications ?? []) as any,
    };

    let id = data.id ?? null;
    if (id) {
      const { error } = await context.supabase
        .from("pv_equipment_library")
        .update(payload as any)
        .eq("id", id);
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
    } else {
      const { data: inserted, error } = await context.supabase
        .from("pv_equipment_library")
        .insert({ ...payload, created_by: (context as any).user.id } as any)
        .select("id")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        if ((error as any).code === "23505") httpError(409, "duplicate_model");
        throw error;
      }
      id = inserted.id as string;
    }

    await auditPvLibrary(context, "pv_library.equipment_saved", id!, {
      category: data.category,
      manufacturer: data.manufacturer,
      model: data.model,
    });
    return { id: id! };
  });

export const setPvEquipmentActive = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { error } = await context.supabase
      .from("pv_equipment_library")
      .update({ is_active: data.isActive } as any)
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await auditPvLibrary(context, "pv_library.equipment_saved", data.id, {
      is_active: data.isActive,
    });
    return { ok: true };
  });

export const createPvUploadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        equipmentId: z.string().uuid(),
        fileName: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ bucket: string; path: string; signedUrl: string; token: string }> => {
      requireSupabaseAuth(context);
      const ext = fileExtension(data.fileName);
      if (!PV_ALLOWED_EXTENSIONS.includes(ext)) httpError(400, "unsupported_extension");
      if (!(await canWritePvLibrary(context))) httpError(403, "forbidden");

      const { data: row, error } = await context.supabase
        .from("pv_equipment_library")
        .select("id, company_id")
        .eq("id", data.equipmentId)
        .maybeSingle();
      if (error) throw error;
      if (!row) httpError(404, "equipment_not_found");

      const path = `${pvStoragePrefix((row as any).company_id, data.equipmentId)}${Date.now()}-${sanitizeFilename(data.fileName)}`;
      const { data: signed, error: sErr } = await context.supabase.storage
        .from(PV_DOCS_BUCKET)
        .createSignedUploadUrl(path);
      if (sErr) throw sErr;
      return {
        bucket: PV_DOCS_BUCKET,
        path,
        signedUrl: signed.signedUrl,
        token: signed.token,
      };
    },
  );

export const registerPvUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        equipmentId: z.string().uuid(),
        path: z.string().min(1).max(500),
        fileName: z.string().trim().min(1).max(255),
        kind: z.enum(["datasheet", "doc"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("pv_equipment_library")
      .select("id, company_id, category, model, docs")
      .eq("id", data.equipmentId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "equipment_not_found");

    const prefix = pvStoragePrefix((row as any).company_id, data.equipmentId);
    if (!data.path.startsWith(prefix)) {
      httpError(400, "bad_file_path", `File must live under ${prefix}`);
    }

    const patch: Record<string, any> =
      data.kind === "datasheet"
        ? { datasheet_path: data.path }
        : {
            docs: [
              ...(Array.isArray((row as any).docs) ? (row as any).docs : []),
              { name: data.fileName, path: data.path, uploaded_at: new Date().toISOString() },
            ],
          };

    const { error: upErr } = await context.supabase
      .from("pv_equipment_library")
      .update(patch as any)
      .eq("id", data.equipmentId);
    if (upErr) {
      if ((upErr as any).code === "42501") httpError(403, "forbidden");
      throw upErr;
    }

    await auditPvLibrary(context, "pv_library.spec_uploaded", data.equipmentId, {
      category: (row as any).category,
      model: (row as any).model,
      kind: data.kind,
      file_name: data.fileName,
    });
    return { ok: true };
  });

export const getPvFileUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    requireSupabaseAuth(context);
    const { data: signed, error } = await context.supabase.storage
      .from(PV_DOCS_BUCKET)
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

export const removePvDoc = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ equipmentId: z.string().uuid(), path: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("pv_equipment_library")
      .select("id, docs, datasheet_path")
      .eq("id", data.equipmentId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "equipment_not_found");

    const docs = (Array.isArray((row as any).docs) ? (row as any).docs : []).filter(
      (d: any) => d?.path !== data.path,
    );
    const patch: Record<string, any> = { docs };
    if ((row as any).datasheet_path === data.path) patch.datasheet_path = null;

    const { error: upErr } = await context.supabase
      .from("pv_equipment_library")
      .update(patch as any)
      .eq("id", data.equipmentId);
    if (upErr) {
      if ((upErr as any).code === "42501") httpError(403, "forbidden");
      throw upErr;
    }
    try {
      await context.supabase.storage.from(PV_DOCS_BUCKET).remove([data.path]);
    } catch {
      // best effort
    }
    return { ok: true };
  });
