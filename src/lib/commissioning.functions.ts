// P-093 — Commissioning core server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

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
