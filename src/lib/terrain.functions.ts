// P-160 — Terrain server functions (thin wrapper module; helpers live in terrain.server.ts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertProjectVisible,
  auditTerrain,
  canWriteTerrain,
  fileExtension,
  httpError,
  insertInChunks,
  rollbackSurface,
  sanitizeFilename,
  TERRAIN_ALLOWED_EXTENSIONS,
  TERRAIN_BUCKET,
  terrainStoragePrefix,
} from "@/lib/terrain.server";
import { extractContours } from "@/lib/terrain/contours";
import { buildElevationGrid, fillHoles } from "@/lib/terrain/grid";
import { parseTerrainFile, TerrainParseError } from "@/lib/terrain/parse";

export type TerrainSurfaceRow = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  revision_code: string;
  crs: string;
  grid_spacing_m: number;
  grid_rows: number | null;
  grid_cols: number | null;
  min_elevation_m: number | null;
  max_elevation_m: number | null;
  source_type: string;
  source_notes: string | null;
  created_at: string;
};

export type TerrainPointRow = {
  easting: number;
  northing: number;
  elevation_m: number;
  grid_row: number | null;
  grid_col: number | null;
};

export type TerrainContourRow = {
  id: string;
  elevation_m: number;
  is_major: boolean;
  geometry: { type: string; coordinates: number[][] };
};

export const getTerrainWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await canWriteTerrain(context) };
  });

export const listTerrainSurfaces = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<TerrainSurfaceRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("terrain_surfaces")
      .select(
        "id, project_id, name, status, revision_code, crs, grid_spacing_m, grid_rows, grid_cols, min_elevation_m, max_elevation_m, source_type, source_notes, created_at",
      )
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as TerrainSurfaceRow[];
  });

export const getTerrainSurface = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ surfaceId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      surface: TerrainSurfaceRow | null;
      points: TerrainPointRow[];
      contours: TerrainContourRow[];
    }> => {
      requireSupabaseAuth(context);
      const { data: surface, error } = await context.supabase
        .from("terrain_surfaces")
        .select(
          "id, project_id, name, status, revision_code, crs, grid_spacing_m, grid_rows, grid_cols, min_elevation_m, max_elevation_m, source_type, source_notes, created_at",
        )
        .eq("id", data.surfaceId)
        .maybeSingle();
      if (error) throw error;
      if (!surface) return { surface: null, points: [], contours: [] };

      const { data: points, error: pErr } = await context.supabase
        .from("terrain_points")
        .select("easting, northing, elevation_m, grid_row, grid_col")
        .eq("surface_id", data.surfaceId)
        .limit(40000);
      if (pErr) throw pErr;

      const { data: contours, error: cErr } = await context.supabase
        .from("contour_lines")
        .select("id, elevation_m, is_major, geometry")
        .eq("surface_id", data.surfaceId)
        .order("elevation_m", { ascending: true })
        .limit(4000);
      if (cErr) throw cErr;

      return {
        surface: surface as TerrainSurfaceRow,
        points: (points ?? []) as TerrainPointRow[],
        contours: (contours ?? []) as unknown as TerrainContourRow[],
      };
    },
  );

export const createTerrainUploadUrl = createServerFn({ method: "POST" })
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
      if (!(await canWriteTerrain(context))) httpError(403, "forbidden");
      const ext = fileExtension(data.fileName);
      if (!TERRAIN_ALLOWED_EXTENSIONS.includes(ext)) httpError(400, "unsupported_extension");
      const project = await assertProjectVisible(context, data.projectId);
      const path = `${terrainStoragePrefix(project.company_id, data.projectId)}${crypto.randomUUID()}-${sanitizeFilename(data.fileName)}`;
      const { data: signed, error } = await context.supabase.storage
        .from(TERRAIN_BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw error;
      return { bucket: TERRAIN_BUCKET, path, signedUrl: signed.signedUrl, token: signed.token };
    },
  );

/**
 * Server is the authority: it downloads the stored source, parses + validates it,
 * then writes terrain_surfaces + terrain_points + contour_lines. Any failure after
 * the surface insert rolls the surface back (cascade removes children).
 */
export const parseTerrainSurface = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        path: z.string().min(1).max(500),
        fileName: z.string().trim().min(1).max(255),
        name: z.string().trim().min(1).max(120),
        revisionCode: z.string().trim().min(1).max(12).default("A"),
        contourInterval: z.number().positive().max(500).default(1),
        crs: z.string().trim().min(1).max(60).default("EPSG:4326"),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ surfaceId: string; points: number; contours: number }> => {
      requireSupabaseAuth(context);
      if (!(await canWriteTerrain(context))) httpError(403, "forbidden");
      const project = await assertProjectVisible(context, data.projectId);
      const userId = (context as any).user.id as string;

      const { data: blob, error: dlErr } = await context.supabase.storage
        .from(TERRAIN_BUCKET)
        .download(data.path);
      if (dlErr || !blob) httpError(404, "file_not_found", "The uploaded file could not be read.");
      const text = await blob.text();

      let parsed;
      try {
        parsed = parseTerrainFile(data.fileName, text);
      } catch (err) {
        if (err instanceof TerrainParseError) httpError(400, err.code, err.message);
        throw err;
      }

      const rawGrid = buildElevationGrid(parsed.points, { spacing: parsed.spacing });
      if (rawGrid.rows < 2 || rawGrid.cols < 2) {
        httpError(
          400,
          "not_a_grid",
          "The source resolves to fewer than 2×2 grid nodes — check the coordinate columns.",
        );
      }
      const grid = fillHoles(rawGrid);
      const contours = extractContours(grid, data.contourInterval, {
        min: parsed.minElevation,
        max: parsed.maxElevation,
        majorEvery: 5,
      });

      // 1) document row for the stored source
      const { data: doc, error: docErr } = await context.supabase
        .from("documents")
        .insert({
          company_id: project.company_id,
          project_id: data.projectId,
          title: `${data.name} — terrain source`,
          category: "other",
          storage_path: data.path,
          file_name: data.fileName,
          mime_type: "text/plain",
          tags: ["terrain-source"],
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (docErr) {
        if ((docErr as any).code === "42501") httpError(403, "forbidden");
        throw docErr;
      }

      // 2) surface
      const { data: surface, error: sErr } = await context.supabase
        .from("terrain_surfaces")
        .insert({
          company_id: project.company_id,
          project_id: data.projectId,
          name: data.name,
          revision_code: data.revisionCode,
          crs: data.crs,
          origin_easting: grid.originE,
          origin_northing: grid.originN,
          grid_spacing_m: grid.spacing,
          grid_rows: grid.rows,
          grid_cols: grid.cols,
          min_elevation_m: parsed.minElevation,
          max_elevation_m: parsed.maxElevation,
          source_type: parsed.kind,
          source_document_id: doc.id,
          source_notes: data.notes ?? null,
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (sErr) {
        if ((sErr as any).code === "42501") httpError(403, "forbidden");
        if ((sErr as any).code === "23505") httpError(409, "duplicate_surface", "A surface with this name and revision already exists.");
        throw sErr;
      }
      const surfaceId = surface.id as string;

      try {
        const pointRows = parsed.points.map((p) => ({
          company_id: project.company_id,
          surface_id: surfaceId,
          easting: p.easting,
          northing: p.northing,
          elevation_m: p.elevation_m,
          grid_row: p.grid_row ?? null,
          grid_col: p.grid_col ?? null,
          point_kind: parsed.kind === "dem_lite" ? "grid_node" : "survey_shot",
          created_by: userId,
        }));
        await insertInChunks(pointRows, 500, (chunk) =>
          context.supabase.from("terrain_points").insert(chunk as any),
        );

        const contourRows = contours.map((line) => ({
          company_id: project.company_id,
          surface_id: surfaceId,
          elevation_m: line.elevation_m,
          is_major: line.is_major,
          geometry: { type: "LineString", coordinates: line.coordinates } as any,
          created_by: userId,
        }));
        await insertInChunks(contourRows, 250, (chunk) =>
          context.supabase.from("contour_lines").insert(chunk as any),
        );
      } catch (err) {
        await rollbackSurface(context, surfaceId);
        if ((err as any)?.code === "42501") httpError(403, "forbidden");
        if ((err as any)?.code === "23505") {
          httpError(400, "duplicate_grid_node", "The source contains duplicate grid nodes.");
        }
        throw err;
      }

      await auditTerrain(context, "terrain.surface_imported", surfaceId, {
        project_id: data.projectId,
        source_type: parsed.kind,
        file_name: data.fileName,
        points: parsed.points.length,
        contours: contours.length,
        contour_interval_m: data.contourInterval,
        grid_rows: grid.rows,
        grid_cols: grid.cols,
      });

      return { surfaceId, points: parsed.points.length, contours: contours.length };
    },
  );

export const deleteTerrainSurface = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ surfaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context))) httpError(403, "forbidden");
    const { error } = await context.supabase
      .from("terrain_surfaces")
      .delete()
      .eq("id", data.surfaceId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await auditTerrain(context, "terrain.surface_deleted", data.surfaceId, {});
    return { ok: true };
  });
