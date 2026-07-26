// P-161 — Civil analysis server functions (thin wrapper; helpers live in civil.server.ts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  assertFeatureEditable,
  assertGeometryKind,
  bumpRevision,
  projectAnchor,
  reserveCivilRefs,
  suggestCivilRef,
  CIVIL_FEATURE_COLUMNS,
  loadCivilFeature,
  loadLayoutBlocks,
  loadSurface,
  loadSurfaceGrid,
  nextFeatureRef,
  nowIso,
  writeAuditLog,
  type CivilFeatureRow,
} from "@/lib/civil.server";
import { computeCutFill, CutFillError, type CutFillResult } from "@/lib/civil/cutfill";
import { proposeDrainagePaths, type DrainageProposal } from "@/lib/civil/flow";
import {
  buildPileSchedule,
  DEFAULT_EMBEDMENT_RULE,
  pilePositionsFromBlock,
  type PileScheduleRow,
  type PileScheduleSummary,
} from "@/lib/civil/piles";
import {
  DEFAULT_MAX_SLOPE_PCT,
  runSlopeTolerance,
  type SlopeCheckBlockResult,
  type SlopeCheckSummary,
} from "@/lib/civil/slopeCheck";
import {
  buildCoordinateSchedule,
  coordinateScheduleToCsv,
  type CoordinateScheduleRow,
} from "@/lib/civil/schedule";
import {
  CIVIL_FEATURE_TYPES,
  CIVIL_STATUSES,
} from "@/lib/civil/feature-types";
import { buildKml, geometryToLngLat } from "@/lib/civil/kml";
import { buildFeatureCollection } from "@/lib/geojson";
import { assertProjectVisible, canWriteTerrain, httpError } from "@/lib/terrain.server";
import { sampleElevation } from "@/lib/terrain/grid";

export type { CivilFeatureRow };

export const listCivilFeatures = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ projectId: z.string().uuid(), surfaceId: z.string().uuid().nullish() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CivilFeatureRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("civil_features")
      .select(CIVIL_FEATURE_COLUMNS)
      .eq("project_id", data.projectId)
      .order("feature_type", { ascending: true })
      .order("feature_ref", { ascending: true })
      .limit(1000);
    if (error) throw error;
    return (rows ?? []) as unknown as CivilFeatureRow[];
  });

export const runCutFillAnalysis = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ featureId: z.string().uuid(), surfaceId: z.string().uuid().nullish() })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ feature: CivilFeatureRow; analysis: CutFillResult & { computed_at: string } }> => {
      requireSupabaseAuth(context);
      if (!(await canWriteTerrain(context))) httpError(403, "forbidden", "Engineering role required.");

      const feature = await loadCivilFeature(context, data.featureId);
      if (feature.feature_type !== "grading_zone") {
        httpError(400, "not_a_grading_zone", "Cut and fill runs on grading_zone features only.");
      }
      const surfaceId = data.surfaceId ?? feature.surface_id;
      if (!surfaceId) httpError(400, "no_surface", "Pick a terrain surface for this zone.");

      const surface = await loadSurface(context, surfaceId);
      const grid = await loadSurfaceGrid(context, surface.id, surface.grid_spacing_m);

      let result: CutFillResult;
      try {
        result = computeCutFill(grid, feature.geometry, feature.properties as never);
      } catch (err) {
        if (err instanceof CutFillError) httpError(400, err.code, err.message);
        throw err;
      }

      const analysis = {
        ...result,
        computed_at: nowIso(),
        surface_id: surface.id,
        surface_name: surface.name,
        surface_revision: surface.revision_code,
      };
      const { data: updated, error } = await context.supabase
        .from("civil_features")
        .update({
          surface_id: surface.id,
          properties: { ...feature.properties, analysis },
        } as never)
        .eq("id", feature.id)
        .select(CIVIL_FEATURE_COLUMNS)
        .maybeSingle();
      if (error) throw error;

      await writeAuditLog(context, "civil.cutfill_computed", "civil_features", feature.id, {
        project_id: feature.project_id,
        surface_id: surface.id,
        cut_m3: result.cut_m3,
        fill_m3: result.fill_m3,
        net_m3: result.net_m3,
        method: result.method,
      });

      return { feature: (updated ?? feature) as unknown as CivilFeatureRow, analysis };
    },
  );

export const runSlopeToleranceCheck = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        surfaceId: z.string().uuid(),
        layoutId: z.string().uuid().nullish(),
        maxSlopePct: z.number().positive().max(100).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      results: SlopeCheckBlockResult[];
      summary: SlopeCheckSummary & { computed_at: string };
      layoutName: string | null;
    }> => {
      requireSupabaseAuth(context);
      if (!(await canWriteTerrain(context))) httpError(403, "forbidden", "Engineering role required.");

      const surface = await loadSurface(context, data.surfaceId);
      const grid = await loadSurfaceGrid(context, surface.id, surface.grid_spacing_m);
      const { layout, blocks } = await loadLayoutBlocks(context, data.projectId, data.layoutId);
      if (!layout || blocks.length === 0) {
        httpError(400, "no_layout_blocks", "Generate a PV layout before running the slope check.");
      }

      const paramTolerance = Number(
        (layout?.params as Record<string, unknown> | undefined)?.max_slope_pct ?? NaN,
      );
      const tolerance =
        data.maxSlopePct ??
        (Number.isFinite(paramTolerance) ? paramTolerance : DEFAULT_MAX_SLOPE_PCT);

      const { results, summary } = runSlopeTolerance(
        grid,
        blocks.map((b) => ({
          block_id: b.id,
          label: b.label,
          geometry: b.geometry,
          max_slope_pct: null,
        })),
        tolerance,
      );

      const stamped = { ...summary, computed_at: nowIso(), layout_id: layout!.id };
      const { error } = await context.supabase
        .from("terrain_surfaces")
        .update({
          analysis: {
            ...surface.analysis,
            slope_check: { ...stamped, blocks: results },
          },
        } as never)
        .eq("id", surface.id);
      if (error) throw error;

      await writeAuditLog(context, "civil.slope_check_computed", "terrain_surfaces", surface.id, {
        project_id: data.projectId,
        layout_id: layout!.id,
        tolerance_pct: tolerance,
        failing: summary.failing,
        warning: summary.warning,
      });

      return { results, summary: stamped, layoutName: layout!.name };
    },
  );

export const runPileEstimate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        surfaceId: z.string().uuid(),
        layoutId: z.string().uuid().nullish(),
        rule: z
          .object({
            min_embedment_m: z.number().min(0).max(20),
            frost_depth_m: z.number().min(0).max(20),
            uplift_factor: z.number().min(1).max(3),
            target_reveal_m: z.number().min(0).max(10),
            slope_allowance_span_m: z.number().min(0).max(20),
            round_up_to_m: z.number().min(0).max(1).optional(),
            max_pile_length_m: z.number().min(1).max(20).optional(),
          })
          .partial()
          .optional(),
        pileSpacingM: z.number().min(1).max(20).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      rows: PileScheduleRow[];
      summary: PileScheduleSummary;
      embedment_m: number;
      layoutName: string | null;
    }> => {
      requireSupabaseAuth(context);
      const surface = await loadSurface(context, data.surfaceId);
      const grid = await loadSurfaceGrid(context, surface.id, surface.grid_spacing_m);
      const { layout, blocks } = await loadLayoutBlocks(context, data.projectId, data.layoutId);
      if (!layout || blocks.length === 0) {
        httpError(400, "no_layout_blocks", "Generate a PV layout before estimating piles.");
      }

      const { computeSlope } = await import("@/lib/terrain/slope");
      const slope = computeSlope(grid);
      const rule = { ...DEFAULT_EMBEDMENT_RULE, ...(data.rule ?? {}) };
      const positions = blocks.flatMap((b) =>
        pilePositionsFromBlock(
          { block_id: b.id, label: b.label, geometry: b.geometry, module_rows: b.module_rows },
          { pile_spacing_m: data.pileSpacingM ?? 6 },
        ),
      );
      const schedule = buildPileSchedule(positions, grid, slope, rule);

      await writeAuditLog(context, "civil.pile_schedule_computed", "terrain_surfaces", surface.id, {
        project_id: data.projectId,
        layout_id: layout!.id,
        piles: schedule.summary.piles,
        total_length_m: schedule.summary.total_length_m,
      });

      return { ...schedule, layoutName: layout!.name };
    },
  );

export const proposeDrainage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        surfaceId: z.string().uuid(),
        minAccumulationCells: z.number().int().min(2).max(100000).optional(),
        maxPaths: z.number().int().min(1).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ proposals: DrainageProposal[] }> => {
    requireSupabaseAuth(context);
    const surface = await loadSurface(context, data.surfaceId);
    const grid = await loadSurfaceGrid(context, surface.id, surface.grid_spacing_m);
    return {
      proposals: proposeDrainagePaths(grid, {
        minAccumulationCells: data.minAccumulationCells,
        maxPaths: data.maxPaths ?? 5,
      }),
    };
  });

/** Human-in-the-loop: engine proposals are only persisted as DRAFT features. */
export const confirmDrainageProposals = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        surfaceId: z.string().uuid(),
        confirmed: z.literal(true),
        proposals: z
          .array(
            z.object({
              proposal_ref: z.string().min(1).max(40),
              coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
              catchment_m2: z.number().nonnegative().optional(),
              length_m: z.number().nonnegative().optional(),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ created: number; features: CivilFeatureRow[] }> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context))) httpError(403, "forbidden", "Engineering role required.");

    const surface = await loadSurface(context, data.surfaceId);
    let seq = await nextFeatureRef(context, data.projectId, "DRN");

    const rows = data.proposals.map((p) => ({
      company_id: surface.company_id,
      project_id: data.projectId,
      surface_id: surface.id,
      feature_ref: `DRN-${String(seq++).padStart(3, "0")}`,
      name: `Proposed drainage path ${p.proposal_ref}`,
      feature_type: "drainage_path",
      geometry: { type: "LineString", coordinates: p.coordinates },
      properties: {
        source: "d8_flow_accumulation",
        catchment_m2: p.catchment_m2 ?? null,
        length_m: p.length_m ?? null,
        proposal_ref: p.proposal_ref,
        confirmed_at: nowIso(),
      },
      status: "draft" as const,
    }));

    const { data: inserted, error } = await context.supabase
      .from("civil_features")
      .insert(rows as never)
      .select(CIVIL_FEATURE_COLUMNS);
    if (error) throw error;

    await writeAuditLog(context, "civil.drainage_proposals_saved", "terrain_surfaces", surface.id, {
      project_id: data.projectId,
      created: rows.length,
      refs: rows.map((r) => r.feature_ref),
    });

    return {
      created: rows.length,
      features: (inserted ?? []) as unknown as CivilFeatureRow[],
    };
  });

export const exportCivilCoordinateSchedule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        surfaceId: z.string().uuid().nullish(),
        featureIds: z.array(z.string().uuid()).max(500).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ csv: string; fileName: string; rows: CoordinateScheduleRow[] }> => {
      requireSupabaseAuth(context);
      await assertExportAllowed(context.supabase, data.projectId, "csv");

      let query = context.supabase
        .from("civil_features")
        .select(CIVIL_FEATURE_COLUMNS)
        .eq("project_id", data.projectId)
        .order("feature_ref", { ascending: true })
        .limit(500);
      if (data.featureIds?.length) query = query.in("id", data.featureIds);
      const { data: features, error } = await query;
      if (error) throw error;
      const list = (features ?? []) as unknown as CivilFeatureRow[];
      if (list.length === 0) httpError(400, "no_features", "No civil features to export.");

      let sampler: ((e: number, n: number) => number | null) | undefined;
      if (data.surfaceId) {
        const surface = await loadSurface(context, data.surfaceId);
        const grid = await loadSurfaceGrid(context, surface.id, surface.grid_spacing_m);
        sampler = (e: number, n: number) => sampleElevation(grid, e, n);
      }

      const rows = buildCoordinateSchedule(
        list.map((f) => ({
          feature_ref: f.feature_ref,
          name: f.name,
          feature_type: f.feature_type,
          geometry: f.geometry,
          status: f.status,
        })),
        sampler,
      );

      await writeAuditLog(
        context,
        "export.civil_coordinate_schedule",
        "civil_features",
        null,
        { project_id: data.projectId, features: list.length, vertices: rows.length },
      );

      return {
        csv: coordinateScheduleToCsv(rows),
        fileName: `civil-coordinate-schedule-${data.projectId.slice(0, 8)}.csv`,
        rows,
      };
    },
  );

/* ---------------------------------------------------------------------------
 * P-162 — Civil feature editor mutations and IO
 * ------------------------------------------------------------------------ */

const geometrySchema = z.object({
  type: z.string().min(1),
  coordinates: z.unknown(),
});

const featureTypeSchema = z.enum(CIVIL_FEATURE_TYPES);

const saveSchema = z.object({
  id: z.string().uuid().nullish(),
  projectId: z.string().uuid(),
  surfaceId: z.string().uuid().nullish(),
  featureType: featureTypeSchema,
  name: z.string().trim().min(1).max(120),
  featureRef: z
    .string()
    .trim()
    .regex(/^CVL-\d{4,}$/)
    .nullish(),
  geometry: geometrySchema,
  properties: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(CIVIL_STATUSES).default("draft"),
});

export const suggestCivilFeatureRef = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ featureRef: string }> => {
    requireSupabaseAuth(context);
    return { featureRef: await suggestCivilRef(context, data.projectId) };
  });

export const saveCivilFeature = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }): Promise<CivilFeatureRow> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context)))
      httpError(403, "forbidden", "Engineering role required to edit civil features.");

    // Never trust the client: the geometry kind must match the feature type.
    assertGeometryKind(data.featureType, data.geometry as never);

    if (data.id) {
      const existing = await loadCivilFeature(context, data.id);
      assertFeatureEditable(existing);
      const { data: row, error } = await context.supabase
        .from("civil_features")
        .update({
          name: data.name,
          feature_type: data.featureType,
          surface_id: data.surfaceId ?? null,
          geometry: data.geometry as never,
          properties: data.properties as never,
          status: data.status,
        })
        .eq("id", data.id)
        .select(CIVIL_FEATURE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!row) httpError(404, "feature_not_found", "Civil feature not found.");
      await writeAuditLog(context, "civil.feature_saved", "civil_features", data.id, {
        feature_ref: (row as never as CivilFeatureRow).feature_ref,
        feature_type: data.featureType,
        status: data.status,
        mode: "update",
      });
      return row as unknown as CivilFeatureRow;
    }

    const project = await assertProjectVisible(context, data.projectId);
    const featureRef = data.featureRef ?? (await suggestCivilRef(context, data.projectId));
    const { data: row, error } = await context.supabase
      .from("civil_features")
      .insert({
        company_id: project.company_id,
        project_id: data.projectId,
        surface_id: data.surfaceId ?? null,
        feature_ref: featureRef,
        name: data.name,
        feature_type: data.featureType,
        geometry: data.geometry as never,
        properties: data.properties as never,
        status: data.status,
      } as never)
      .select(CIVIL_FEATURE_COLUMNS)
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        httpError(409, "duplicate_feature_ref", `${featureRef} already exists on this project.`);
      }
      throw error;
    }
    const created = row as unknown as CivilFeatureRow;
    await writeAuditLog(context, "civil.feature_saved", "civil_features", created.id, {
      feature_ref: created.feature_ref,
      feature_type: data.featureType,
      status: data.status,
      mode: "create",
    });
    return created;
  });

export const deleteCivilFeature = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ deleted: true }> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context)))
      httpError(403, "forbidden", "Engineering role required to delete civil features.");
    const existing = await loadCivilFeature(context, data.id);
    assertFeatureEditable(existing);
    const { error } = await context.supabase.from("civil_features").delete().eq("id", data.id);
    if (error) throw error;
    await writeAuditLog(context, "civil.feature_deleted", "civil_features", data.id, {
      feature_ref: existing.feature_ref,
      feature_type: existing.feature_type,
      revision_code: existing.revision_code,
    });
    return { deleted: true };
  });

/** Unfreeze an approved feature by cutting the next revision (A → B → …). */
export const reviseCivilFeature = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CivilFeatureRow> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context)))
      httpError(403, "forbidden", "Engineering role required to revise civil features.");
    const existing = await loadCivilFeature(context, data.id);
    const revision = bumpRevision(existing.revision_code);
    const { data: row, error } = await context.supabase
      .from("civil_features")
      .update({ status: "draft", revision_code: revision })
      .eq("id", data.id)
      .select(CIVIL_FEATURE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    await writeAuditLog(context, "civil.feature_saved", "civil_features", data.id, {
      feature_ref: existing.feature_ref,
      mode: "revision",
      from_revision: existing.revision_code,
      revision_code: revision,
    });
    return row as unknown as CivilFeatureRow;
  });

export const importCivilFeatures = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        surfaceId: z.string().uuid().nullish(),
        source: z.enum(["geojson", "kml"]),
        features: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              featureType: featureTypeSchema,
              geometry: geometrySchema,
              properties: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ imported: number; features: CivilFeatureRow[] }> => {
    requireSupabaseAuth(context);
    if (!(await canWriteTerrain(context)))
      httpError(403, "forbidden", "Engineering role required to import civil features.");

    for (const f of data.features) assertGeometryKind(f.featureType, f.geometry as never);

    const project = await assertProjectVisible(context, data.projectId);
    const refs = await reserveCivilRefs(context, data.projectId, data.features.length);
    const rows = data.features.map((f, i) => ({
      company_id: project.company_id,
      project_id: data.projectId,
      surface_id: data.surfaceId ?? null,
      feature_ref: refs[i],
      name: f.name,
      feature_type: f.featureType,
      geometry: f.geometry,
      properties: { ...f.properties, imported_from: data.source, imported_at: nowIso() },
      // Imports always land as drafts for engineering review.
      status: "draft",
    }));
    const { data: inserted, error } = await context.supabase
      .from("civil_features")
      .insert(rows as never)
      .select(CIVIL_FEATURE_COLUMNS);
    if (error) throw error;
    await writeAuditLog(context, "civil.features_imported", "civil_features", null, {
      project_id: data.projectId,
      source: data.source,
      count: rows.length,
    });
    return {
      imported: rows.length,
      features: (inserted ?? []) as unknown as CivilFeatureRow[],
    };
  });

export const exportCivilFeatures = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        format: z.enum(["geojson", "kml"]),
        featureTypes: z.array(featureTypeSchema).nullish(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ fileName: string; mimeType: string; content: string; count: number }> => {
      requireSupabaseAuth(context);
      await assertExportAllowed(
        context.supabase as never,
        data.projectId,
        data.format === "kml" ? "civil_kml" : "civil_geojson",
      );

      let query = context.supabase
        .from("civil_features")
        .select(CIVIL_FEATURE_COLUMNS)
        .eq("project_id", data.projectId)
        .order("feature_ref", { ascending: true })
        .limit(2000);
      if (data.featureTypes && data.featureTypes.length) {
        query = query.in("feature_type", data.featureTypes as never);
      }
      const { data: rows, error } = await query;
      if (error) throw error;
      const features = (rows ?? []) as unknown as CivilFeatureRow[];
      if (features.length === 0) httpError(400, "nothing_to_export", "No civil features to export.");

      const anchor = await projectAnchor(context, data.projectId);
      let content: string;
      let fileName: string;
      let mimeType: string;

      if (data.format === "geojson") {
        content = JSON.stringify(
          buildFeatureCollection(
            features.map((f) => ({
              geometry: f.geometry as never,
              properties: {
                ...f.properties,
                kind: f.feature_type,
                feature_ref: f.feature_ref,
                name: f.name,
                status: f.status,
                revision_code: f.revision_code,
              },
            })),
          ),
          null,
          2,
        );
        fileName = `civil-features-${data.projectId.slice(0, 8)}.geojson`;
        mimeType = "application/geo+json";
      } else {
        content = buildKml(
          features.map((f) => ({
            feature_ref: f.feature_ref,
            name: f.name,
            feature_type: f.feature_type,
            status: f.status,
            revision_code: f.revision_code,
            geometry: geometryToLngLat(f.geometry as never, { lon: anchor.lon, lat: anchor.lat }),
            properties: f.properties,
          })),
          { documentName: `${anchor.name} — civil features` },
        );
        fileName = `civil-features-${data.projectId.slice(0, 8)}.kml`;
        mimeType = "application/vnd.google-earth.kml+xml";
      }

      await writeAuditLog(context, "export.civil_features", "civil_features", null, {
        project_id: data.projectId,
        format: data.format,
        count: features.length,
      });
      return { fileName, mimeType, content, count: features.length };
    },
  );
