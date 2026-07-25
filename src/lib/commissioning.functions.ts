// P-093 / P-094 — Commissioning core server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { withIdempotency } from "@/lib/offline-mirror";


export const COMMISSIONING_TEST_TYPES = [
  "insulation_resistance",
  "hipot",
  "iv_curve",
  "string_test",
  "continuity",
  "earth_resistance",
  "functional",
  "other",
] as const;
export type CommissioningTestType = (typeof COMMISSIONING_TEST_TYPES)[number];

export const COMMISSIONING_TEST_STATUSES = [
  "not_started",
  "scheduled",
  "in_progress",
  "passed",
  "failed",
  "on_hold",
] as const;
export type CommissioningTestStatus =
  (typeof COMMISSIONING_TEST_STATUSES)[number];

export const COMMISSIONING_TEST_TYPE_LABELS: Record<
  CommissioningTestType,
  string
> = {
  insulation_resistance: "Insulation Resistance (IR)",
  hipot: "Hipot",
  iv_curve: "IV Curve",
  string_test: "String Test",
  continuity: "Continuity",
  earth_resistance: "Earth Resistance",
  functional: "Functional",
  other: "Other",
};

export interface CommissioningTestRow {
  id: string;
  company_id: string;
  project_id: string;
  area: string;
  equipment_ref: string | null;
  string_ref: string | null;
  test_type: CommissioningTestType;
  status: CommissioningTestStatus;
  assigned_to: string | null;
  assigned_email: string | null;
  planned_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  utility_witness_required: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommissioningMemberPick {
  id: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// helpers (module-level; consumed by handlers)
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

const COMMISSIONING_WRITE_ROLES = new Set([
  "construction_admin",
  "company_admin",
  "project_admin",
  "engineer",
  "field_technician",
  "foreman",
]);
function canWrite(roles: string[]): boolean {
  return roles.some((r) => COMMISSIONING_WRITE_ROLES.has(r));
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid(),
  testType: z.enum(COMMISSIONING_TEST_TYPES).nullish(),
  status: z.enum(COMMISSIONING_TEST_STATUSES).nullish(),
  area: z.string().nullish(),
  search: z.string().nullish(),
});

export const listCommissioningTests = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw))
  .handler(
    async ({ data, context }): Promise<{
      rows: CommissioningTestRow[];
      canWrite: boolean;
    }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const roles = await currentRoles(context);

      let q = context.supabase
        .from("commissioning_tests")
        .select(
          "id, company_id, project_id, area, equipment_ref, string_ref, test_type, status, assigned_to, planned_date, started_at, completed_at, utility_witness_required, notes, created_at, updated_at, profiles:assigned_to(email)",
        )
        .eq("company_id", companyId)
        .eq("project_id", data.projectId)
        .order("area", { ascending: true })
        .order("created_at", { ascending: true });

      if (data.testType) q = q.eq("test_type", data.testType);
      if (data.status) q = q.eq("status", data.status);
      if (data.area) q = q.eq("area", data.area);
      if (data.search) {
        const s = `%${data.search}%`;
        q = q.or(
          `area.ilike.${s},equipment_ref.ilike.${s},string_ref.ilike.${s},notes.ilike.${s}`,
        );
      }

      const { data: rows, error } = await q;
      if (error) throw error;
      return {
        canWrite: canWrite(roles),
        rows: ((rows ?? []) as any[]).map((r) => ({
          id: r.id,
          company_id: r.company_id,
          project_id: r.project_id,
          area: r.area,
          equipment_ref: r.equipment_ref,
          string_ref: r.string_ref,
          test_type: r.test_type,
          status: r.status,
          assigned_to: r.assigned_to,
          assigned_email: r.profiles?.email ?? null,
          planned_date: r.planned_date,
          started_at: r.started_at,
          completed_at: r.completed_at,
          utility_witness_required: r.utility_witness_required,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      };
    },
  );

// ---------------------------------------------------------------------------
// project members picker
// ---------------------------------------------------------------------------
export const listCommissioningAssignees = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(raw),
  )
  .handler(
    async ({ data, context }): Promise<CommissioningMemberPick[]> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const { data: rows, error } = await context.supabase
        .from("project_members")
        .select("user_id, profiles:user_id(email)")
        .eq("project_id", data.projectId)
        .eq("company_id", companyId);
      if (error) throw error;
      return ((rows ?? []) as any[]).map((r) => ({
        id: r.user_id as string,
        email: (r.profiles?.email as string | null) ?? null,
      }));
    },
  );

// ---------------------------------------------------------------------------
// assign (bulk)
// ---------------------------------------------------------------------------
const assignInput = z.object({
  projectId: z.string().uuid(),
  area: z.string().trim().min(1).max(120),
  testTypes: z.array(z.enum(COMMISSIONING_TEST_TYPES)).min(1),
  equipmentRef: z.string().trim().max(120).nullish(),
  stringRef: z.string().trim().max(120).nullish(),
  assignedTo: z.string().uuid().nullish(),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  utilityWitnessRequired: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullish(),
});

export const assignCommissioningTests = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => assignInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ids: string[] }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWrite(roles)) httpError(403, "forbidden");

    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(400, "invalid_project");

    const uniqueTypes = Array.from(new Set(data.testTypes));
    const payload = uniqueTypes.map((t) => ({
      company_id: companyId,
      project_id: data.projectId,
      area: data.area,
      equipment_ref: data.equipmentRef ?? null,
      string_ref: data.stringRef ?? null,
      test_type: t,
      status: (data.plannedDate ? "scheduled" : "not_started") as
        | "scheduled"
        | "not_started",
      assigned_to: data.assignedTo ?? null,
      planned_date: data.plannedDate ?? null,
      utility_witness_required:
        t === "hipot" ? true : data.utilityWitnessRequired,
      notes: data.notes ?? null,
      created_by: context.user!.id,
    }));

    const { data: rows, error } = await context.supabase
      .from("commissioning_tests")
      .insert(payload)
      .select("id, test_type, area, assigned_to");

    if (error) throw error;
    const ids = ((rows ?? []) as any[]).map((r) => r.id as string);

    for (const r of (rows ?? []) as any[]) {
      await audit(
        context,
        "commissioning.test_assigned",
        "commissioning_tests",
        r.id,
        {
          test_type: r.test_type,
          area: r.area,
          assigned_to: r.assigned_to,
        },
      );
    }

    return { ids };
  });

// ---------------------------------------------------------------------------
// P-094 — Execution: get / save result / witness / re-open
// ---------------------------------------------------------------------------

const EXECUTE_ROLES = new Set([
  "field_technician",
  "foreman",
  "engineer",
  "construction_admin",
]);
const READ_ONLY_ROLES = new Set([
  "om_admin",
  "project_admin",
  "company_admin",
]);
function canExecute(roles: string[]): boolean {
  return roles.some((r) => EXECUTE_ROLES.has(r));
}
function canReopen(roles: string[]): boolean {
  return roles.some(
    (r) => r === "construction_admin" || r === "company_admin",
  );
}
function canRead(roles: string[]): boolean {
  return (
    canExecute(roles) || roles.some((r) => READ_ONLY_ROLES.has(r))
  );
}

export interface CommissioningTestDetail extends CommissioningTestRow {
  utility_witness_name: string | null;
  utility_witnessed_at: string | null;
  witness_file_path: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>;
}


export interface CommissioningIvPoint {
  voltageV: number;
  currentA: number;
}
export interface CommissioningIvSummary {
  voc: number;
  isc: number;
  pmax: number;
  ff: number;
}

/**
 * Compute IV summary from an array of {voltageV, currentA} points.
 * - Sorts by V asc.
 * - Voc: linear interp between the two rows straddling I=0, else last-V.
 * - Isc: linear interp between the two rows straddling V=0, else first-I.
 * - Pmax: max(V*I).
 * - FF: Pmax / (Voc * Isc).
 * Exported for unit tests.
 */
export function computeIvSummary(
  points: CommissioningIvPoint[],
): CommissioningIvSummary | null {
  const clean = points
    .filter(
      (p) =>
        Number.isFinite(p.voltageV) && Number.isFinite(p.currentA),
    )
    .slice()
    .sort((a, b) => a.voltageV - b.voltageV);
  if (clean.length < 2) return null;

  // Voc — V where I crosses zero.
  let voc = clean[clean.length - 1]!.voltageV;
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    if ((a.currentA >= 0 && b.currentA <= 0) || (a.currentA <= 0 && b.currentA >= 0)) {
      const denom = b.currentA - a.currentA;
      if (denom === 0) {
        voc = a.currentA === 0 ? a.voltageV : b.voltageV;
      } else {
        voc = a.voltageV + ((0 - a.currentA) / denom) * (b.voltageV - a.voltageV);
      }
      break;
    }
  }

  // Isc — I where V crosses zero.
  let isc = clean[0]!.currentA;
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    if ((a.voltageV <= 0 && b.voltageV >= 0) || (a.voltageV >= 0 && b.voltageV <= 0)) {
      const denom = b.voltageV - a.voltageV;
      if (denom === 0) {
        isc = a.voltageV === 0 ? a.currentA : b.currentA;
      } else {
        isc = a.currentA + ((0 - a.voltageV) / denom) * (b.currentA - a.currentA);
      }
      break;
    }
  }

  let pmax = 0;
  for (const p of clean) {
    const power = p.voltageV * p.currentA;
    if (power > pmax) pmax = power;
  }
  const ff = voc > 0 && isc > 0 ? pmax / (voc * isc) : 0;
  return {
    voc: round4(voc),
    isc: round4(isc),
    pmax: round4(pmax),
    ff: round4(ff),
  };
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// -- get for execute ---------------------------------------------------------
const getExecuteInput = z.object({ testId: z.string().uuid() });

export const getCommissioningTestForExecute = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => getExecuteInput.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      test: CommissioningTestDetail | null;
      canExecute: boolean;
      canReopen: boolean;
      canRead: boolean;
    }> => {
      requireSupabaseAuth(context);
      const roles = await currentRoles(context);
      const companyId = await currentCompanyId(context);

      const { data: row, error } = await context.supabase
        .from("commissioning_tests")
        .select(
          "id, company_id, project_id, area, equipment_ref, string_ref, test_type, status, assigned_to, planned_date, started_at, completed_at, result, utility_witness_required, utility_witness_name, utility_witnessed_at, witness_file_path, notes, created_at, updated_at, profiles:assigned_to(email)",
        )
        .eq("id", data.testId)
        .maybeSingle();
      if (error) throw error;

      // Cross-tenant / RLS-hidden → not found.
      if (!row || (row as any).company_id !== companyId) {
        return {
          test: null,
          canExecute: false,
          canReopen: false,
          canRead: canRead(roles),
        };
      }

      const r = row as any;
      return {
        test: {
          id: r.id,
          company_id: r.company_id,
          project_id: r.project_id,
          area: r.area,
          equipment_ref: r.equipment_ref,
          string_ref: r.string_ref,
          test_type: r.test_type,
          status: r.status,
          assigned_to: r.assigned_to,
          assigned_email: r.profiles?.email ?? null,
          planned_date: r.planned_date,
          started_at: r.started_at,
          completed_at: r.completed_at,
          utility_witness_required: r.utility_witness_required,
          utility_witness_name: r.utility_witness_name,
          utility_witnessed_at: r.utility_witnessed_at,
          witness_file_path: r.witness_file_path,
          result: (r.result ?? {}) as Record<string, any>,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
        },
        canExecute: canExecute(roles),
        canReopen: canReopen(roles),
        canRead: canRead(roles),
      };
    },
  );

// -- save result -------------------------------------------------------------
const saveResultInput = z.object({
  testId: z.string().uuid(),
  status: z.enum(["passed", "failed"]),
  result: z.record(z.string(), z.unknown()),
  notes: z.string().trim().max(4000).nullish(),
  clientIdempotencyKey: z.string().min(1).max(80).nullish(),
});

export const saveCommissioningTestResult = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => saveResultInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; status: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canExecute(roles)) httpError(403, "forbidden");

    return withIdempotency(
      context,
      {
        key: data.clientIdempotencyKey ?? null,
        entity: "commissioning",
        action: "save_result",
        companyId,
        input: data,
      },
      async () => {
        const { data: row, error } = await context.supabase
          .from("commissioning_tests")
          .select(
            "id, company_id, project_id, test_type, status, started_at, utility_witness_required, utility_witness_name, utility_witnessed_at, witness_file_path",
          )
          .eq("id", data.testId)
          .maybeSingle();
        if (error) throw error;
        if (!row || (row as any).company_id !== companyId)
          httpError(404, "test_not_found");
        const r = row as any;

        if (
          r.utility_witness_required &&
          data.status === "passed" &&
          (!r.witness_file_path ||
            !r.utility_witnessed_at ||
            !r.utility_witness_name)
        ) {
          httpError(
            409,
            "witness_required",
            "Utility witness record required to pass this test",
          );
        }

        const now = new Date().toISOString();
        const update: Record<string, unknown> = {
          status: data.status,
          result: data.result,
          completed_at: now,
          started_at: r.started_at ?? now,
        };
        if (data.notes !== undefined && data.notes !== null) {
          update.notes = data.notes;
        }

        const { error: upErr } = await context.supabase
          .from("commissioning_tests")
          .update(update as any)
          .eq("id", data.testId);
        if (upErr) throw upErr;

        await audit(
          context,
          "commissioning.test_executed",
          "commissioning_tests",
          data.testId,
          { test_type: r.test_type, status: data.status },
        );

        return { id: data.testId, status: data.status };
      },
    );
  });

// -- witness ----------------------------------------------------------------
const witnessInput = z.object({
  testId: z.string().uuid(),
  witnessName: z.string().trim().min(1).max(160),
  witnessFilePath: z.string().trim().min(1).max(400),
  clientIdempotencyKey: z.string().min(1).max(80).nullish(),
});

export const recordUtilityWitness = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => witnessInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; witnessedAt: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canExecute(roles)) httpError(403, "forbidden");

    return withIdempotency(
      context,
      {
        key: data.clientIdempotencyKey ?? null,
        entity: "commissioning",
        action: "record_witness",
        companyId,
        input: data,
      },
      async () => {
        const { data: row, error } = await context.supabase
          .from("commissioning_tests")
          .select("id, company_id, project_id")
          .eq("id", data.testId)
          .maybeSingle();
        if (error) throw error;
        if (!row || (row as any).company_id !== companyId)
          httpError(404, "test_not_found");
        const r = row as any;

        // Enforce path shape: {company_id}/witness/{project_id}/{test_id}/...
        const expectedPrefix = `${companyId}/witness/${r.project_id}/${data.testId}/`;
        if (!data.witnessFilePath.startsWith(expectedPrefix)) {
          httpError(400, "invalid_witness_path");
        }

        const now = new Date().toISOString();
        const { error: upErr } = await context.supabase
          .from("commissioning_tests")
          .update({
            utility_witness_name: data.witnessName,
            utility_witnessed_at: now,
            witness_file_path: data.witnessFilePath,
          } as any)
          .eq("id", data.testId);
        if (upErr) throw upErr;

        await audit(
          context,
          "commissioning.witness_recorded",
          "commissioning_tests",
          data.testId,
          { path: data.witnessFilePath },
        );

        return { id: data.testId, witnessedAt: now };
      },
    );
  });

// -- reopen -----------------------------------------------------------------
const reopenInput = z.object({
  testId: z.string().uuid(),
  clientIdempotencyKey: z.string().min(1).max(80).nullish(),
});

export const reopenCommissioningTest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => reopenInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canReopen(roles)) httpError(403, "forbidden");

    return withIdempotency(
      context,
      {
        key: data.clientIdempotencyKey ?? null,
        entity: "commissioning",
        action: "reopen",
        companyId,
        input: data,
      },
      async () => {
        const { data: row, error } = await context.supabase
          .from("commissioning_tests")
          .select("id, company_id, status, test_type")
          .eq("id", data.testId)
          .maybeSingle();
        if (error) throw error;
        if (!row || (row as any).company_id !== companyId)
          httpError(404, "test_not_found");
        const r = row as any;
        if (r.status !== "passed" && r.status !== "failed") {
          httpError(409, "not_completed", "Only completed tests can be re-opened");
        }

        const { error: upErr } = await context.supabase
          .from("commissioning_tests")
          .update({
            status: "in_progress",
            completed_at: null,
          } as any)
          .eq("id", data.testId);
        if (upErr) throw upErr;

        await audit(
          context,
          "commissioning.test_reopened",
          "commissioning_tests",
          data.testId,
          { test_type: r.test_type },
        );
        return { id: data.testId };
      },
    );
  });

