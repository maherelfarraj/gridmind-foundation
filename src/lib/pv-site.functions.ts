// P-151 — PV site configuration server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { pvSiteConfigSchema, type PvSiteConfigRow } from "@/lib/pv-site.schemas";
import {
  assertProjectVisible,
  auditPvSite,
  canWritePvSite,
  fileExtension,
  httpError,
  PV_SITE_ALLOWED_EXTENSIONS,
  PV_SITE_BUCKET,
  pvSiteStoragePrefix,
  sanitizeFilename,
  toPvSiteRow,
} from "@/lib/pv-site.server";

export const listPvSiteConfigs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PvSiteConfigRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("pv_site_configs")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toPvSiteRow);
  });

/** KPI hook: the single active config + its target capacities. */
export const getActivePvSiteConfig = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      config: PvSiteConfigRow | null;
      targetDcKwp: number | null;
      targetAcKwp: number | null;
    }> => {
      requireSupabaseAuth(context);
      const { data: row, error } = await context.supabase
        .from("pv_site_configs")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      if (!row) return { config: null, targetDcKwp: null, targetAcKwp: null };
      const config = toPvSiteRow(row as any);
      return {
        config,
        targetDcKwp: config.weather_meta.targets.target_dc_kwp ?? null,
        targetAcKwp: config.weather_meta.targets.target_ac_kwp ?? null,
      };
    },
  );

export const getPvSiteWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await canWritePvSite(context) };
  });

export const savePvSiteConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => pvSiteConfigSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await canWritePvSite(context))) httpError(403, "forbidden");
    const project = await assertProjectVisible(context, data.projectId);

    const payload = {
      company_id: project.company_id,
      project_id: data.projectId,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      altitude_m: data.altitude_m ?? null,
      timezone: data.timezone ?? null,
      terrain_slope_pct: data.terrain_slope_pct ?? null,
      terrain_azimuth_deg: data.terrain_azimuth_deg ?? null,
      albedo: data.albedo,
      weather_source: data.weather_source,
      weather_meta: data.weather_meta as any,
      boundary: data.boundary as any,
      exclusions: data.exclusions as any,
      usable_area_ha: data.usable_area_ha ?? null,
    };

    let id = data.id ?? null;
    if (id) {
      const { error } = await context.supabase
        .from("pv_site_configs")
        .update(payload as any)
        .eq("id", id)
        .eq("project_id", data.projectId);
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        if ((error as any).code === "23505") httpError(409, "duplicate_name");
        throw error;
      }
    } else {
      const { data: inserted, error } = await context.supabase
        .from("pv_site_configs")
        .insert({ ...payload, created_by: (context as any).user.id } as any)
        .select("id")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        if ((error as any).code === "23505") httpError(409, "duplicate_name");
        throw error;
      }
      id = inserted.id as string;
    }

    await auditPvSite(context, "pv_site.saved", id!, {
      project_id: data.projectId,
      name: data.name,
      weather_source: data.weather_source,
      exclusion_count: data.exclusions.length,
      boundary_vertices: (data.boundary.coordinates?.[0]?.length ?? 0) as number,
    });
    return { id: id! };
  });

/** Activate one config and supersede every other active/approved one on the project. */
export const activatePvSiteConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; superseded: number }> => {
    requireSupabaseAuth(context);
    if (!(await canWritePvSite(context))) httpError(403, "forbidden");

    const { data: target, error: tErr } = await context.supabase
      .from("pv_site_configs")
      .select("id, project_id, boundary, name")
      .eq("id", data.id)
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target) httpError(404, "config_not_found");
    const ring = ((target as any).boundary?.coordinates ?? [])[0] ?? [];
    if (ring.length < 4) httpError(400, "no_boundary", "Draw a site boundary before activating.");

    const { data: others, error: oErr } = await context.supabase
      .from("pv_site_configs")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("status", "active")
      .neq("id", data.id);
    if (oErr) throw oErr;

    if (others && others.length) {
      const { error: supErr } = await context.supabase
        .from("pv_site_configs")
        .update({ status: "superseded" } as any)
        .in(
          "id",
          others.map((o: any) => o.id),
        );
      if (supErr) {
        if ((supErr as any).code === "42501") httpError(403, "forbidden");
        throw supErr;
      }
    }

    const { error } = await context.supabase
      .from("pv_site_configs")
      .update({ status: "active" } as any)
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }

    await auditPvSite(context, "pv_site.saved", data.id, {
      project_id: data.projectId,
      action: "activated",
      superseded: (others ?? []).map((o: any) => o.id),
    });
    return { ok: true, superseded: (others ?? []).length };
  });

export const createPvWeatherUploadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
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
      if (!(await canWritePvSite(context))) httpError(403, "forbidden");
      const ext = fileExtension(data.fileName);
      if (!PV_SITE_ALLOWED_EXTENSIONS.includes(ext)) httpError(400, "unsupported_extension");
      const project = await assertProjectVisible(context, data.projectId);

      const path = `${pvSiteStoragePrefix(project.company_id, data.projectId)}${Date.now()}-${sanitizeFilename(data.fileName)}`;
      const { data: signed, error } = await context.supabase.storage
        .from(PV_SITE_BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw error;
      return { bucket: PV_SITE_BUCKET, path, signedUrl: signed.signedUrl, token: signed.token };
    },
  );

export const getPvSiteFileUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    requireSupabaseAuth(context);
    const { data: signed, error } = await context.supabase.storage
      .from(PV_SITE_BUCKET)
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed.signedUrl };
  });
