// P-144 — Server-only helpers for SLD schedule generation and export.
// Kept out of the *.functions.ts module so server-fn splitting cannot drop them.
import { toCsv } from "@/lib/csv";
import { loadValidationGraph, type ValidationGraph } from "./sld-validation.server";
import { cadHttpError, type CadDrawing } from "./sld-cad.server";
import {
  buildSchedules,
  SCHEDULE_TYPES,
  scheduleMatrix,
  type ScheduleArea,
  type ScheduleRow,
  type ScheduleSymbolMeta,
  type ScheduleType,
} from "./sld/schedules";

/** Rows are plain JSON scalars so they cross the server-fn boundary cleanly. */
export type ScheduleJsonRow = Record<string, string | number | boolean | null>;

export type ScheduleRecord = {
  id: string;
  revision_id: string;
  schedule_type: ScheduleType;
  rows: ScheduleJsonRow[];
  row_count: number;
  generated_at: string;
  generated_by: string | null;
};

function isScheduleType(value: string): value is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(value);
}

export function toScheduleRecord(row: any): ScheduleRecord {
  return {
    id: row.id as string,
    revision_id: row.revision_id as string,
    schedule_type: row.schedule_type as ScheduleType,
    rows: Array.isArray(row.rows) ? (row.rows as ScheduleJsonRow[]) : [],
    row_count: Number(row.row_count ?? 0),
    generated_at: row.generated_at as string,
    generated_by: (row.generated_by ?? null) as string | null,
  };
}

/** Symbol registry rows (incl. svg_body) merged with company overrides. */
export async function loadScheduleSymbols(
  context: any,
  companyId: string,
): Promise<ScheduleSymbolMeta[]> {
  const { data, error } = await context.supabase
    .from("sld_symbol_types")
    .select("type_key, display_name, category, svg_body, tag_prefix, company_id")
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw error;

  const byKey = new Map<string, ScheduleSymbolMeta>();
  for (const row of ((data ?? []) as any[]).sort((a, b) =>
    a.company_id === b.company_id ? 0 : a.company_id ? 1 : -1,
  )) {
    byKey.set(row.type_key as string, {
      type_key: row.type_key as string,
      display_name: row.display_name ?? null,
      category: row.category ?? null,
      svg_body: row.svg_body ?? null,
      tag_prefix: row.tag_prefix ?? null,
    });
  }
  return [...byKey.values()];
}

export function areasFromCanvas(canvas: Record<string, unknown>): ScheduleArea[] {
  const raw = (canvas as { areas?: unknown }).areas;
  return Array.isArray(raw) ? (raw as ScheduleArea[]) : [];
}

/** Builds every schedule for the drawing's current revision. */
export async function buildDrawingSchedules(
  context: any,
  drawing: CadDrawing,
  graph: ValidationGraph,
) {
  const [symbols, revision, project, company] = await Promise.all([
    loadScheduleSymbols(context, drawing.company_id),
    context.supabase
      .from("sld_revisions")
      .select("revision_code, status, created_at, created_by, issued_at")
      .eq("id", graph.revisionId)
      .maybeSingle(),
    context.supabase
      .from("projects")
      .select("name, code")
      .eq("id", drawing.project_id)
      .maybeSingle(),
    context.supabase.from("companies").select("name").eq("id", drawing.company_id).maybeSingle(),
  ]);

  const rev = (revision as any)?.data ?? null;
  const drawnByRaw = rev?.created_by ?? null;
  let drawnBy: string | null = null;
  if (drawnByRaw) {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", drawnByRaw)
      .maybeSingle();
    drawnBy = ((profile as any)?.full_name ?? (profile as any)?.email ?? null) as string | null;
  }

  return buildSchedules({
    objects: graph.objects,
    connections: graph.connections,
    symbols,
    areas: areasFromCanvas(graph.canvas),
    titleBlock: {
      drawing_number: drawing.drawing_number,
      title: drawing.title,
      revision_code: rev?.revision_code ?? null,
      status: rev?.status ?? drawing.status,
      sheet_size: drawing.sheet_size,
      project_name: ((project as any)?.data?.name ?? null) as string | null,
      project_code: ((project as any)?.data?.code ?? null) as string | null,
      company_name: ((company as any)?.data?.name ?? null) as string | null,
      drawn_by: drawnBy,
      created_at: rev?.created_at ?? null,
      revision_date: rev?.issued_at ?? rev?.created_at ?? null,
    },
  });
}

/** Upserts one row per schedule type on (revision_id, schedule_type). */
export async function upsertSchedules(
  context: any,
  drawing: CadDrawing,
  revisionId: string,
  set: Record<ScheduleType, ScheduleRow[]>,
  userId: string,
): Promise<ScheduleRecord[]> {
  const now = new Date().toISOString();
  const payload = SCHEDULE_TYPES.map((type) => ({
    company_id: drawing.company_id,
    revision_id: revisionId,
    schedule_type: type,
    rows: set[type] as unknown as any,
    row_count: set[type].length,
    generated_by: userId,
    generated_at: now,
  }));

  const { data, error } = await context.supabase
    .from("sld_schedules")
    .upsert(payload as any, { onConflict: "revision_id,schedule_type" })
    .select("id, revision_id, schedule_type, rows, row_count, generated_at, generated_by");
  if (error) throw error;
  return ((data ?? []) as any[]).map(toScheduleRecord);
}

export async function listSchedulesForRevision(
  context: any,
  revisionId: string,
): Promise<ScheduleRecord[]> {
  const { data, error } = await context.supabase
    .from("sld_schedules")
    .select("id, revision_id, schedule_type, rows, row_count, generated_at, generated_by")
    .eq("revision_id", revisionId);
  if (error) throw error;
  return ((data ?? []) as any[]).map(toScheduleRecord);
}

/** Loads a schedule plus the drawing it belongs to (RLS keeps this tenant-scoped). */
export async function loadScheduleWithDrawing(context: any, scheduleId: string) {
  const { data, error } = await context.supabase
    .from("sld_schedules")
    .select("id, company_id, revision_id, schedule_type, rows, row_count, generated_at")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) cadHttpError(404, "schedule_not_found", "Schedule not found.");
  const schedule = data as any;
  if (!isScheduleType(schedule.schedule_type)) {
    cadHttpError(422, "unknown_schedule_type", "Unknown schedule type.");
  }

  const { data: revision, error: revErr } = await context.supabase
    .from("sld_revisions")
    .select("id, drawing_id, revision_code")
    .eq("id", schedule.revision_id)
    .maybeSingle();
  if (revErr) throw revErr;
  if (!revision) cadHttpError(404, "revision_not_found", "Revision not found.");

  const { data: drawing, error: drwErr } = await context.supabase
    .from("sld_drawings")
    .select("id, company_id, project_id, drawing_number, title, status")
    .eq("id", (revision as any).drawing_id)
    .maybeSingle();
  if (drwErr) throw drwErr;
  if (!drawing) cadHttpError(404, "drawing_not_found", "Drawing not found.");

  return {
    schedule: toScheduleRecord(schedule),
    revisionCode: ((revision as any).revision_code ?? null) as string | null,
    drawing: drawing as {
      id: string;
      company_id: string;
      project_id: string;
      drawing_number: string;
      title: string;
      status: string;
    },
  };
}

/** CSV built through the shared export helper, column order from the registry. */
export function scheduleCsv(type: ScheduleType, rows: ScheduleJsonRow[]): string {
  const { headers, body } = scheduleMatrix(type, rows);
  return toCsv(headers, body);
}

export async function loadBranding(context: any, companyId: string) {
  const { data } = await context.supabase
    .from("company_branding")
    .select("logo_url, primary_color, accent_color, footer_text")
    .eq("company_id", companyId)
    .maybeSingle();
  return {
    logo_url: ((data as any)?.logo_url ?? null) as string | null,
    primary_color: ((data as any)?.primary_color ?? null) as string | null,
    accent_color: ((data as any)?.accent_color ?? null) as string | null,
    footer_text: ((data as any)?.footer_text ?? null) as string | null,
  };
}

export async function loadGraphOr409(context: any, drawing: CadDrawing) {
  const graph = await loadValidationGraph(context, drawing);
  if (!graph) cadHttpError(404, "revision_not_found", "No revision to schedule.");
  return graph;
}
