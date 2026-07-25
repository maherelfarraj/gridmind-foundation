// P-054 — SLD config + gallery server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// Constants + schemas
// ---------------------------------------------------------------------------
export const BUS_CONFIGS = ["single", "single_sectionalized", "double", "ring"] as const;
export type BusConfig = (typeof BUS_CONFIGS)[number];

export const VOLTAGE_TYPES = ["collection", "export", "auxiliary"] as const;
export type VoltageType = (typeof VOLTAGE_TYPES)[number];

const WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
] as const;

export interface VoltageLevel {
  kv: number;
  type: VoltageType;
}

export interface MeteringPoint {
  location: string;
  purpose: string;
}

export interface SldConfigRow {
  project_id: string;
  company_id: string;
  bus_config: BusConfig;
  voltage_levels: VoltageLevel[];
  metering_points: MeteringPoint[];
  protection_scheme: string | null;
  notes: string | null;
  updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProjectCompany(
  context: any,
  projectId: string,
): Promise<{ id: string; company_id: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string };
}

async function assertRole(context: any, companyId: string, roles: readonly string[]) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", roles as any)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) httpError(403, "forbidden");
}

async function audit(
  context: any,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    // never break the write
  }
}

// ---------------------------------------------------------------------------
// Get / Save SLD config
// ---------------------------------------------------------------------------
const getInput = z.object({ projectId: z.string().uuid() });

export const getSldConfig = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => getInput.parse(input))
  .handler(async ({ data, context }): Promise<SldConfigRow> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);

    const { data: row, error } = await context.supabase
      .from("project_sld_config")
      .select(
        "project_id, company_id, bus_config, voltage_levels, metering_points, protection_scheme, notes, updated_at",
      )
      .eq("project_id", project.id)
      .maybeSingle();
    if (error) throw error;

    if (!row) {
      return {
        project_id: project.id,
        company_id: project.company_id,
        bus_config: "single",
        voltage_levels: [],
        metering_points: [],
        protection_scheme: null,
        notes: null,
        updated_at: null,
      };
    }
    return {
      project_id: row.project_id,
      company_id: row.company_id,
      bus_config: (row.bus_config as BusConfig) ?? "single",
      voltage_levels: Array.isArray(row.voltage_levels)
        ? (row.voltage_levels as unknown as VoltageLevel[])
        : [],
      metering_points: Array.isArray(row.metering_points)
        ? (row.metering_points as unknown as MeteringPoint[])
        : [],
      protection_scheme: row.protection_scheme ?? null,
      notes: row.notes ?? null,
      updated_at: row.updated_at ?? null,
    };
  });

const voltageLevelSchema = z.object({
  kv: z.number().positive().max(500),
  type: z.enum(VOLTAGE_TYPES),
});

const meteringPointSchema = z.object({
  location: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(120),
});

const saveInput = z.object({
  projectId: z.string().uuid(),
  bus_config: z.enum(BUS_CONFIGS),
  voltage_levels: z.array(voltageLevelSchema).min(1, "At least one voltage level is required"),
  metering_points: z.array(meteringPointSchema).max(50),
  protection_scheme: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const saveSldConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    // Load prior for diff.
    const { data: prior } = await context.supabase
      .from("project_sld_config")
      .select("bus_config, voltage_levels, metering_points, protection_scheme, notes")
      .eq("project_id", project.id)
      .maybeSingle();

    const payload = {
      project_id: project.id,
      company_id: project.company_id,
      bus_config: data.bus_config,
      voltage_levels: data.voltage_levels as any,
      metering_points: data.metering_points as any,
      protection_scheme: data.protection_scheme ?? null,
      notes: data.notes ?? null,
    };

    const { error } = await context.supabase
      .from("project_sld_config")
      .upsert(payload as any, { onConflict: "project_id" });
    if (error) throw error;

    const changed: string[] = [];
    if (!prior) {
      changed.push("created");
    } else {
      for (const key of [
        "bus_config",
        "voltage_levels",
        "metering_points",
        "protection_scheme",
        "notes",
      ] as const) {
        if (
          JSON.stringify((prior as any)[key] ?? null) !==
          JSON.stringify((payload as any)[key] ?? null)
        ) {
          changed.push(key);
        }
      }
    }

    await audit(context, "engineering.sld_config_saved", "project_sld_config", project.id, {
      project_id: project.id,
      changed_fields: changed,
    });

    return { ok: true, changed_fields: changed };
  });

// ---------------------------------------------------------------------------
// SLD drawings gallery
// ---------------------------------------------------------------------------
export interface SldDrawingRow {
  id: string;
  drawing_number: string;
  title: string;
  current_status: string;
  locked: boolean;
  updated_at: string;
  revision_code: string | null;
  revision_id: string | null;
  markup_count: number;
}

const listSldInput = z.object({ projectId: z.string().uuid() });

export const listSldDrawings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listSldInput.parse(input))
  .handler(async ({ data, context }): Promise<SldDrawingRow[]> => {
    requireSupabaseAuth(context);

    const { data: rows, error } = await context.supabase
      .from("drawing_register")
      .select(
        `id, drawing_number, title, current_status, locked, updated_at,
         current_revision:drawing_revisions!drawing_register_current_revision_id_fkey(
           id, revision_code
         )`,
      )
      .eq("project_id", data.projectId)
      .eq("discipline", "electrical")
      .ilike("drawing_number", "SLD-%")
      .order("drawing_number", { ascending: true });
    if (error) throw error;

    const list = (rows ?? []) as any[];
    const revisionIds = list
      .map((r) => {
        const rev = Array.isArray(r.current_revision) ? r.current_revision[0] : r.current_revision;
        return rev?.id as string | undefined;
      })
      .filter((v): v is string => Boolean(v));

    const counts: Record<string, number> = {};
    if (revisionIds.length > 0) {
      const { data: markups } = await context.supabase
        .from("document_markups")
        .select("revision_id")
        .in("revision_id", revisionIds);
      for (const m of (markups ?? []) as any[]) {
        counts[m.revision_id] = (counts[m.revision_id] ?? 0) + 1;
      }
    }

    return list.map((r) => {
      const rev = Array.isArray(r.current_revision) ? r.current_revision[0] : r.current_revision;
      const revId = rev?.id ?? null;
      return {
        id: r.id,
        drawing_number: r.drawing_number,
        title: r.title,
        current_status: r.current_status,
        locked: r.locked,
        updated_at: r.updated_at,
        revision_code: rev?.revision_code ?? null,
        revision_id: revId,
        markup_count: revId ? (counts[revId] ?? 0) : 0,
      };
    });
  });

const createSldInput = z.object({
  projectId: z.string().uuid(),
  drawingNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
});

export const createSldDrawing = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createSldInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertRole(context, project.company_id, WRITE_ROLES);

    const number = /^sld-/i.test(data.drawingNumber)
      ? data.drawingNumber
      : `SLD-${data.drawingNumber}`;

    const { data: inserted, error } = await context.supabase
      .from("drawing_register")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        drawing_number: number,
        title: data.title,
        discipline: "electrical",
        created_by: context.user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "23505") {
        httpError(
          409,
          "drawing_number_taken",
          `Drawing number ${number} already exists in this project.`,
        );
      }
      throw error;
    }

    await audit(context, "drawing.created", "drawing_register", inserted!.id, {
      project_id: project.id,
      drawing_number: number,
      discipline: "electrical",
      source: "sld_gallery",
    });

    return { id: inserted!.id, drawing_number: number };
  });

// ---------------------------------------------------------------------------
// Role check for UI gating
// ---------------------------------------------------------------------------
export const getMySldRoles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("company_id", project.company_id);
    if (error) throw error;
    const roles = ((rows ?? []) as any[]).map((r) => r.role as string);
    const canWrite = roles.some((r) => (WRITE_ROLES as readonly string[]).includes(r));
    return { canWrite };
  });
