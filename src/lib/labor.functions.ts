// P-231 — Timesheet reporting + labor rollup server functions. Thin wrappers:
// helpers live in labor.server.ts, math in src/lib/timesheets/reports.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { toCsv } from "@/lib/csv";
import {
  assertProjectsExportable,
  countBacklog,
  leaveDaysYtd,
  loadProjectNames,
  loadRateContext,
  loadReportEntries,
} from "@/lib/labor.server";
import {
  hasAnyRole,
  httpError,
  writeAuditLog,
  TIMESHEET_ADMIN_ROLES,
} from "@/lib/timesheets.server";
import {
  aggregateLaborActuals,
  aggregatePerPerson,
  aggregatePerProject,
  buildDisciplineMatrix,
  buildPayrollRows,
  computeKpis,
  monthRange,
  PAYROLL_COLUMNS,
  REPORT_FORMULAS,
  round2,
  type DisciplineMatrix,
  type LaborActuals,
  type PersonReportRow,
  type ProjectReportRow,
  type ReportKpis,
} from "@/lib/timesheets/reports";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");

const READ_ROLES = [...TIMESHEET_ADMIN_ROLES, "finance_admin"] as const;

const filtersSchema = z.object({
  from: isoDate,
  to: isoDate,
  project_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
});

export type ReportFilterInput = z.infer<typeof filtersSchema>;

export interface TimesheetReport {
  filters: ReportFilterInput;
  kpis: ReportKpis;
  formulas: typeof REPORT_FORMULAS;
  per_person: PersonReportRow[];
  per_project: ProjectReportRow[];
  discipline_matrix: DisciplineMatrix;
  missing_rate_rows: number;
  people: Record<string, string>;
  projects: Record<string, string>;
  project_options: Array<{ id: string; name: string }>;
  people_options: Array<{ id: string; name: string }>;
  can_export: boolean;
}

async function assertReadAccess(context: {
  supabase: Parameters<typeof hasAnyRole>[0];
}): Promise<void> {
  if (!(await hasAnyRole(context.supabase, READ_ROLES))) httpError(403, "forbidden");
}

export const getTimesheetReport = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ context, data }): Promise<TimesheetReport> => {
    requireSupabaseAuth(context);
    await assertReadAccess(context);
    const client = context.supabase;

    const entries = await loadReportEntries(client, data);
    const rateCtx = await loadRateContext(client, entries);
    const [backlog, leaveYtd] = await Promise.all([
      countBacklog(client, data.project_id ?? null),
      leaveDaysYtd(client),
    ]);

    const perProject = aggregatePerProject(entries, rateCtx);
    const projectIds = [...new Set(entries.map((e) => e.project_id).filter(Boolean))] as string[];
    const projects = await loadProjectNames(client, projectIds);

    const [{ data: projectRows }, { data: peopleRows }] = await Promise.all([
      client.from("projects").select("id, name").order("name").limit(500),
      client.from("profiles").select("id, full_name").order("full_name").limit(500),
    ]);

    return {
      filters: data,
      kpis: computeKpis({ entries, backlogCount: backlog, leaveDaysYtd: leaveYtd }),
      formulas: REPORT_FORMULAS,
      per_person: aggregatePerPerson(entries),
      per_project: perProject,
      discipline_matrix: buildDisciplineMatrix(entries, rateCtx),
      missing_rate_rows: perProject.reduce((s, r) => s + r.missing_rate_rows, 0),
      people: rateCtx.people,
      projects,
      project_options: ((projectRows ?? []) as Array<{ id: string; name: string | null }>).map(
        (p) => ({ id: p.id, name: p.name?.trim() || p.id }),
      ),
      people_options: ((peopleRows ?? []) as Array<{ id: string; full_name: string | null }>).map(
        (p) => ({ id: p.id, name: p.full_name?.trim() || "Team member" }),
      ),
      can_export: await hasAnyRole(client, TIMESHEET_ADMIN_ROLES),
    };
  });

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

export const exportTimesheetReportCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    filtersSchema.extend({ tab: z.enum(["person", "project", "discipline"]) }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<{ filename: string; csv: string; rows: number }> => {
    requireSupabaseAuth(context);
    await assertReadAccess(context);
    const client = context.supabase;

    // Gated only when a project filter narrows the report to one project.
    await assertProjectsExportable(client, [data.project_id ?? null], "timesheet_report");

    const entries = await loadReportEntries(client, data);
    const rateCtx = await loadRateContext(client, entries);
    const projects = await loadProjectNames(
      client,
      entries.map((e) => e.project_id).filter(Boolean) as string[],
    );
    const name = (id: string | null) => (id ? (projects[id] ?? id) : "—");
    const person = (id: string) => rateCtx.people[id] ?? id;

    let headers: string[] = [];
    let rows: (readonly unknown[])[] = [];

    if (data.tab === "person") {
      const activities = [...new Set(entries.map((e) => e.activity))].sort();
      headers = ["employee", ...activities, "total_hours", "overtime_hours", "approval_status"];
      rows = aggregatePerPerson(entries).map((r) => [
        person(r.user_id),
        ...activities.map((a) => r.hours_by_activity[a] ?? 0),
        r.total_hours,
        r.overtime_hours,
        r.statuses.join("/"),
      ]);
    } else if (data.tab === "project") {
      headers = ["project", "employee", "discipline", "hours", "labor_cost", "missing_rate_rows"];
      rows = aggregatePerProject(entries, rateCtx).map((r) => [
        name(r.project_id),
        person(r.user_id),
        r.discipline,
        r.hours,
        r.labor_cost,
        r.missing_rate_rows,
      ]);
    } else {
      const matrix = buildDisciplineMatrix(entries, rateCtx);
      headers = ["discipline", ...matrix.projects.map((p) => name(p)), "total"];
      rows = matrix.disciplines.map((d) => [
        d,
        ...matrix.projects.map((p) => matrix.cells[`${d}|${p ?? "-"}`] ?? 0),
        matrix.disciplineTotals[d] ?? 0,
      ]);
    }

    return {
      filename: `timesheet-${data.tab}-${data.from}_${data.to}.csv`,
      csv: toCsv(headers, rows),
      rows: rows.length,
    };
  });

export const exportPayrollCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ context, data }): Promise<{ filename: string; csv: string; rows: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context.supabase, TIMESHEET_ADMIN_ROLES))) httpError(403, "forbidden");
    const client = context.supabase;

    // Approved timesheets only — payroll never sees unapproved hours.
    const entries = await loadReportEntries(client, { ...data, statuses: ["approved"] });
    // Every project touched by the export must be unlocked (any lock → 423).
    await assertProjectsExportable(
      client,
      entries.map((e) => e.project_id),
      "timesheet_payroll",
    );

    const rateCtx = await loadRateContext(client, entries);
    const projects = await loadProjectNames(
      client,
      entries.map((e) => e.project_id).filter(Boolean) as string[],
    );
    const rows = buildPayrollRows(entries, rateCtx, {
      people: rateCtx.people,
      projects,
    });

    await writeAuditLog(client, "timesheet.payroll_exported", "timesheet", null, {
      from: data.from,
      to: data.to,
      project_id: data.project_id ?? null,
      user_id: data.user_id ?? null,
      row_count: rows.length,
    });

    return {
      filename: `payroll-${data.from}_${data.to}.csv`,
      csv: toCsv([...PAYROLL_COLUMNS], rows),
      rows: rows.length,
    };
  });

// ---------------------------------------------------------------------------
// Labor rollup — preferred actuals source for P-213 and EVM
// ---------------------------------------------------------------------------

export const getLaborActuals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid(), period: periodSchema }).parse(raw),
  )
  .handler(async ({ context, data }): Promise<LaborActuals> => {
    requireSupabaseAuth(context);
    const client = context.supabase;
    const { from, to } = monthRange(data.period);
    const entries = await loadReportEntries(client, {
      from,
      to,
      project_id: data.project_id,
      statuses: ["approved"],
    });
    const rateCtx = await loadRateContext(client, entries);
    return aggregateLaborActuals(data.project_id, data.period, entries, rateCtx);
  });

export function laborCostRounded(actuals: LaborActuals): number {
  return round2(actuals.labor_cost);
}
