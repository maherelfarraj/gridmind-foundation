// P-165 — Server-only helpers for the electrical-analysis study record.
// Kept out of the *.functions.ts module so the serverfn-split transform cannot
// drop runtime siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  EA_APPROVAL_ENTITY,
  EA_APPROVAL_RULE_KEY,
  formatStudyNumber,
  nextStudySequence,
  type EaStudyStatus,
  type EaStudyType,
} from "@/lib/ea/study-types";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const EA_TABLE = "ea_studies";
export const EA_REVISION_TABLE = "ea_study_revisions";

export const EA_STUDY_COLUMNS =
  "id, company_id, project_id, study_number, title, study_type, revision, status, " +
  "input_sheet, assumptions, method, results, warnings, standards_ref, reviewer_id, " +
  "approval_instance_id, submitted_at, approved_at, created_by, created_at, updated_at";

export const EA_REVISION_COLUMNS =
  "id, company_id, study_id, revision, status, input_sheet, assumptions, method, results, " +
  "warnings, standards_ref, change_summary, reviewer_id, approval_instance_id, created_by, created_at";

export type EaStudyRow = {
  id: string;
  company_id: string;
  project_id: string;
  study_number: string;
  title: string;
  study_type: EaStudyType;
  revision: number;
  status: EaStudyStatus;
  input_sheet: Record<string, JsonValue>;
  assumptions: JsonValue[];
  method: string;
  results: Record<string, JsonValue>;
  warnings: JsonValue[];
  standards_ref: string[];
  reviewer_id: string | null;
  approval_instance_id: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EaRevisionRow = Omit<
  EaStudyRow,
  | "project_id"
  | "study_number"
  | "title"
  | "study_type"
  | "submitted_at"
  | "approved_at"
  | "updated_at"
> & { study_id: string; change_summary: string | null };

export class EaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EaHttpError";
  }
}

export function eaError(status: number, code: string, message?: string): never {
  throw new Response(JSON.stringify({ code, message: message ?? code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Roles allowed to author or edit studies (RLS enforces the same set). */
export async function canWriteStudy(context: AuthContext, companyId: string): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", ["engineer", "engineering_admin", "project_admin", "company_admin", "super_admin"])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function loadStudy(context: AuthContext, studyId: string): Promise<EaStudyRow> {
  const { data, error } = await context.supabase
    .from(EA_TABLE)
    .select(EA_STUDY_COLUMNS)
    .eq("id", studyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) eaError(404, "study_not_found", "Study not found.");
  return data as unknown as EaStudyRow;
}

/** Resolves the caller's company through their project membership row. */
export async function loadProjectScope(
  context: AuthContext,
  projectId: string,
): Promise<{ id: string; company_id: string; name: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) eaError(404, "project_not_found", "Project not found.");
  return data as unknown as { id: string; company_id: string; name: string };
}

/**
 * Next EA-#### for a company. `unique (company_id, study_number)` is the real
 * race guard; callers retry once on a 23505 conflict.
 */
export async function reserveStudyNumber(context: AuthContext, companyId: string): Promise<string> {
  const { data, error } = await context.supabase
    .from(EA_TABLE)
    .select("study_number")
    .eq("company_id", companyId);
  if (error) throw error;
  const existing = ((data ?? []) as Array<{ study_number: string }>).map((r) => r.study_number);
  return formatStudyNumber(nextStudySequence(existing));
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "23505";
}

/** Appends an immutable snapshot of the study's current payload. */
export async function snapshotStudy(
  context: AuthContext,
  study: EaStudyRow,
  changeSummary: string,
): Promise<void> {
  const { error } = await context.supabase.from(EA_REVISION_TABLE).insert({
    company_id: study.company_id,
    study_id: study.id,
    revision: study.revision,
    status: study.status,
    input_sheet: study.input_sheet,
    assumptions: study.assumptions,
    method: study.method,
    results: study.results,
    warnings: study.warnings,
    standards_ref: study.standards_ref,
    change_summary: changeSummary,
    reviewer_id: study.reviewer_id,
    approval_instance_id: study.approval_instance_id,
    created_by: study.created_by,
  } as never);
  // A duplicate (study_id, revision) means the snapshot already exists; the
  // history stays append-only and the caller keeps going.
  if (error && !isUniqueViolation(error)) throw error;
}

export async function loadRevisions(
  context: AuthContext,
  studyId: string,
): Promise<EaRevisionRow[]> {
  const { data, error } = await context.supabase
    .from(EA_REVISION_TABLE)
    .select(EA_REVISION_COLUMNS)
    .eq("study_id", studyId)
    .order("revision", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EaRevisionRow[];
}

export type EaApprovalStep = {
  id: string;
  approver_id: string;
  step_order: number;
  status: string;
  decided_at: string | null;
  comment: string | null;
};

export type EaApprovalSnapshot = {
  id: string;
  status: string;
  current_step: number;
  sla_due_at: string | null;
  requested_at: string | null;
  steps: EaApprovalStep[];
} | null;

export async function loadApproval(
  context: AuthContext,
  studyId: string,
): Promise<EaApprovalSnapshot> {
  const { data, error } = await context.supabase
    .from("approval_instances")
    .select("id, status, current_step, sla_due_at, requested_at")
    .eq("entity_type", EA_APPROVAL_ENTITY)
    .eq("entity_id", studyId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const instance = (data ?? [])[0] as
    | {
        id: string;
        status: string;
        current_step: number | null;
        sla_due_at: string | null;
        requested_at: string | null;
      }
    | undefined;
  if (!instance) return null;

  const { data: steps, error: stepError } = await context.supabase
    .from("approvals")
    .select("id, approver_id, step_order, status, decided_at, comment")
    .eq("instance_id", instance.id)
    .order("step_order", { ascending: true });
  if (stepError) throw stepError;

  return {
    id: instance.id,
    status: instance.status,
    current_step: instance.current_step ?? 1,
    sla_due_at: instance.sla_due_at,
    requested_at: instance.requested_at,
    steps: (steps ?? []) as unknown as EaApprovalStep[],
  };
}

/** Opens the engineer → engineering_admin chain via the P-111 engine. */
export async function startStudyApproval(
  context: AuthContext,
  study: EaStudyRow,
): Promise<string | null> {
  const { data, error } = await context.supabase.rpc("start_approval_instance", {
    p_rule_key: EA_APPROVAL_RULE_KEY,
    p_entity_type: EA_APPROVAL_ENTITY,
    p_entity_id: study.id,
    p_amount: null as never,
    p_metadata: {
      study_number: study.study_number,
      revision: study.revision,
      study_type: study.study_type,
    } as never,
  });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function auditStudy(
  context: AuthContext,
  action: string,
  studyId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: EA_TABLE,
      p_entity_id: studyId,
      p_metadata: metadata as never,
    });
  } catch {
    // audit must never fail the request
  }
}
