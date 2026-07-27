// P-228 — Timesheet server functions. Thin wrappers only: helpers live in
// timesheets.server.ts and the pure libs under src/lib/timesheets/.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  applyCells,
  assertCanEdit,
  assertDraft,
  currentCompanyId,
  getOrCreateWeek,
  hasAnyRole,
  httpError,
  listCwpsSafe,
  listEntries,
  loadTimesheet,
  RATE_ADMIN_ROLES,
  TIMESHEET_ADMIN_ROLES,
  writeAuditLog,
} from "@/lib/timesheets.server";
import type { TimesheetMetadata } from "@/lib/timesheets.server";
import { TIMESHEET_ACTIVITIES } from "@/lib/timesheets/policy";
import { isMonday } from "@/lib/timesheets/week";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const mondaySchema = isoDate.refine(isMonday, "week_start must be a Monday");
const activitySchema = z.enum(TIMESHEET_ACTIVITIES as unknown as [string, ...string[]]);

export const getOrCreateTimesheet = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ week_start: mondaySchema }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const companyId = await currentCompanyId(context.supabase, userId);
    const sheet = await getOrCreateWeek(context.supabase, userId, companyId, data.week_start);
    const entries = await listEntries(context.supabase, sheet.id);
    return { timesheet: sheet, entries, canEdit: sheet.status === "draft" };
  });

export const upsertTimesheetEntries = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        timesheetId: z.string().uuid(),
        cells: z
          .array(
            z.object({
              work_date: isoDate,
              project_id: z.string().uuid().nullable().default(null),
              cwp_id: z.string().uuid().nullable().default(null),
              activity: activitySchema,
              hours: z.number().min(0).max(24),
              notes: z.string().max(2000).nullable().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const sheet = await loadTimesheet(context.supabase, data.timesheetId);
    await assertCanEdit(context.supabase, sheet, context.user!.id);
    assertDraft(sheet);
    const result = await applyCells(context.supabase, sheet, data.cells);
    return {
      entries: result.entries,
      totals: { regular: result.regular, overtime: result.overtime },
    };
  });

export const saveClockMetadata = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        timesheetId: z.string().uuid(),
        clock: z.record(
          isoDate,
          z.object({
            start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
            end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
          }),
        ),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const sheet = await loadTimesheet(context.supabase, data.timesheetId);
    await assertCanEdit(context.supabase, sheet, context.user!.id);
    assertDraft(sheet);
    const metadata: TimesheetMetadata = { ...(sheet.metadata ?? {}), clock: data.clock };
    const { error } = await context.supabase
      .from("timesheets")
      .update({ metadata: metadata as never })
      .eq("id", sheet.id);
    if (error) throw error;
    return { ok: true, metadata };
  });

export const submitTimesheet = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        timesheetId: z.string().uuid(),
        clientIdempotencyKey: z.string().min(8).max(80).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const sheet = await loadTimesheet(context.supabase, data.timesheetId);
    await assertCanEdit(context.supabase, sheet, context.user!.id);
    // Idempotent: a queued retry of an already-submitted week is a no-op.
    if (sheet.status !== "draft") {
      return { ok: true, alreadySubmitted: true, status: sheet.status };
    }
    const entries = await listEntries(context.supabase, sheet.id);
    if (entries.length === 0) httpError(422, "empty_timesheet", "Add hours before submitting.");
    if (entries.some((e) => e.hours < 0 || e.hours > 24)) {
      httpError(422, "invalid_hours", "Hours must be between 0 and 24.");
    }
    const recomputed = await applyCells(context.supabase, sheet, []);
    const { error } = await context.supabase
      .from("timesheets")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        submitted_by: context.user!.id,
      })
      .eq("id", sheet.id)
      .eq("status", "draft");
    if (error) throw error;
    await writeAuditLog(context.supabase, "timesheet.submitted", "timesheets", sheet.id, {
      week_start: sheet.week_start,
      timesheet_number: sheet.timesheet_number,
      regular: recomputed.regular,
      overtime: recomputed.overtime,
      client_idempotency_key: data.clientIdempotencyKey ?? null,
    });
    return { ok: true, alreadySubmitted: false, status: "submitted" };
  });

export const listTimesheetProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string; code: string | null }>;
  });

export const listTimesheetCwps = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listCwpsSafe(context.supabase, data.projectId);
  });

export const getMyHourlyRate = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, default_hourly_rate")
      .eq("id", context.user!.id)
      .maybeSingle();
    if (error) throw error;
    const canEdit = await hasAnyRole(context.supabase, RATE_ADMIN_ROLES);
    const isTimesheetAdmin = await hasAnyRole(context.supabase, TIMESHEET_ADMIN_ROLES);
    return {
      userId: context.user!.id,
      fullName: (data as { full_name: string | null } | null)?.full_name ?? null,
      rate: (data as { default_hourly_rate: number | null } | null)?.default_hourly_rate ?? null,
      canEdit,
      isTimesheetAdmin,
    };
  });

export const updateDefaultHourlyRate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ user_id: z.string().uuid(), rate: z.number().min(0).max(100000).nullable() })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context.supabase, RATE_ADMIN_ROLES))) httpError(403, "forbidden_role");
    const { error } = await context.supabase
      .from("profiles")
      .update({ default_hourly_rate: data.rate })
      .eq("id", data.user_id);
    if (error) throw error;
    await writeAuditLog(context.supabase, "timesheet.rate_updated", "profiles", data.user_id, {
      rate: data.rate,
      updated_by: context.user!.id,
    });
    return { ok: true, rate: data.rate };
  });
