// P-033 — Project creation gating.
// Returns the active company's plan tier and whether the green_hydrogen
// module is enabled. UI uses this to decide whether the Green H₂ archetype
// card is selectable. The final creation gate (P-036) re-checks server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import {
  budgetLineSchema,
  gateSchema,
  PROJECT_DEPARTMENTS,
  type BudgetLine,
  type Gate,
  type ProjectDepartment,
} from "@/lib/schemas/project-wizard";
import type { PlanTier } from "./permissions";
import type { ProjectArchetype } from "./wizard-draft";

const inputSchema = z.object({ companyId: z.string().uuid() });

export type ProjectCreationAccess = {
  planTier: PlanTier;
  greenHydrogenEnabled: boolean;
};

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const getProjectCreationAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProjectCreationAccess> => {
    requireSupabaseAuth(context);

    const { data: member, error: memberErr } = await context.supabase.rpc(
      "is_company_member",
      { p_company_id: data.companyId },
    );
    if (memberErr) throw memberErr;
    if (member !== true) httpError(403, "forbidden");

    const { data: company, error: coErr } = await context.supabase
      .from("companies")
      .select("plan_tier")
      .eq("id", data.companyId)
      .maybeSingle();
    if (coErr) throw coErr;
    if (!company) httpError(404, "tenant_not_found");

    const { data: hasAccess, error: modErr } = await context.supabase.rpc(
      "has_module_access",
      { p_company_id: data.companyId, p_module: "green_hydrogen" },
    );
    if (modErr) throw modErr;

    return {
      planTier: company.plan_tier as PlanTier,
      greenHydrogenEnabled: hasAccess === true,
    };
  });

// ---------------------------------------------------------------------------
// P-035 — List project templates for an archetype (company + system).
// ---------------------------------------------------------------------------

const ARCHETYPES = [
  "utility_pv",
  "standalone_bess",
  "c_and_i_rooftop",
  "hybrid_pv_bess",
  "onshore_wind",
  "green_hydrogen",
  "transmission_substation",
] as const;

const listTemplatesInput = z.object({
  companyId: z.string().uuid(),
  archetype: z.enum(ARCHETYPES),
});

export type TemplateOption = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  archetype: ProjectArchetype;
  gates: Gate[];
  budgetLines: BudgetLine[];
  departments: ProjectDepartment[];
};

const gatesArray = z.array(gateSchema);
const budgetArray = z.array(budgetLineSchema);
const deptArray = z.array(z.enum(PROJECT_DEPARTMENTS));

export const listProjectTemplates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listTemplatesInput.parse(input))
  .handler(async ({ data, context }): Promise<TemplateOption[]> => {
    requireSupabaseAuth(context);

    const { data: member, error: memberErr } = await context.supabase.rpc(
      "is_company_member",
      { p_company_id: data.companyId },
    );
    if (memberErr) throw memberErr;
    if (member !== true) httpError(403, "forbidden");

    const { data: rows, error } = await context.supabase
      .from("project_templates")
      .select(
        "id,name,description,is_system,archetype,default_gates,default_budget_lines,default_departments",
      )
      .eq("company_id", data.companyId)
      .eq("archetype", data.archetype)
      .order("is_system", { ascending: false })
      .order("name");
    if (error) throw error;

    const out: TemplateOption[] = [];
    for (const r of rows ?? []) {
      const gates = gatesArray.safeParse(r.default_gates);
      const budget = budgetArray.safeParse(r.default_budget_lines);
      const depts = deptArray.safeParse(r.default_departments);
      if (!gates.success || !budget.success || !depts.success) {
        console.warn("[listProjectTemplates] skipping malformed template", r.id);
        continue;
      }
      out.push({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        archetype: r.archetype as ProjectArchetype,
        gates: gates.data,
        budgetLines: budget.data,
        departments: depts.data,
      });
    }
    return out;
  });

// ---------------------------------------------------------------------------
// P-036 — Team pickers + createProject.
// ---------------------------------------------------------------------------

import { Constants } from "@/integrations/supabase/types";
import {
  DEPT_LEAD_ROLES,
  makeCreateProjectSchema,
  PROJECT_PHASES,
  type DeptLeadKey,
} from "@/lib/schemas/project-wizard";


export type EligibleUser = {
  id: string;
  full_name: string | null;
  email: string | null;
};

const listEligibleInput = z.object({
  companyId: z.string().uuid(),
  role: z.enum(Constants.public.Enums.app_role),
});

export const listEligibleUsers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listEligibleInput.parse(input))
  .handler(async ({ data, context }): Promise<EligibleUser[]> => {
    requireSupabaseAuth(context);

    const { data: rows, error } = await context.supabase
      .from("user_roles")
      .select("user_id, profiles:profiles!inner(id, full_name, email, company_id)")
      .eq("company_id", data.companyId)
      .eq("role", data.role);
    if (error) throw error;

    const out: EligibleUser[] = [];
    const seen = new Set<string>();
    for (const r of (rows ?? []) as Array<{
      user_id: string;
      profiles: {
        id: string;
        full_name: string | null;
        email: string | null;
        company_id: string;
      } | null;
    }>) {
      const p = r.profiles;
      if (!p || p.company_id !== data.companyId) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, full_name: p.full_name, email: p.email });
    }
    out.sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );
    return out;
  });

const listMembersInput = z.object({ companyId: z.string().uuid() });

export const listActiveCompanyProfiles = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listMembersInput.parse(input))
  .handler(async ({ data, context }): Promise<EligibleUser[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", data.companyId);
    if (error) throw error;
    const list = (rows ?? []) as EligibleUser[];
    list.sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );
    return list;
  });

const ARCHETYPE_ENUM = z.enum(ARCHETYPES);
const DEPT_ENUM = z.enum(PROJECT_DEPARTMENTS);
const uuidNullable = z.string().uuid().nullable();

const createProjectInput = z.object({
  companyId: z.string().uuid(),
  archetype: ARCHETYPE_ENUM,
  template_id: uuidNullable,
  name: z.string().trim().min(3).max(120),
  code: z.string().trim().regex(/^[A-Z0-9-]{2,12}$/),
  capacity_mw: z.coerce.number().positive(),
  capacity_mwh: z.coerce.number().positive().optional(),
  site_name: z.string().trim().max(160).optional().or(z.literal("")),
  site_country: z.string().trim().max(80).optional().or(z.literal("")),
  site_region: z.string().trim().max(80).optional().or(z.literal("")),
  site_lat: z.coerce.number().min(-90).max(90).optional(),
  site_lng: z.coerce.number().min(-180).max(180).optional(),
  offtaker: z.string().trim().max(160).optional().or(z.literal("")),
  target_cod: z.coerce.date(),
  project_admin_id: z.string().uuid(),
  member_ids: z.array(z.string().uuid()),
  dept_leads: z.record(z.enum(DEPT_LEAD_ROLES), z.string().uuid()).default({}),
});

const PHASE_LABELS_SHORT: Record<(typeof PROJECT_PHASES)[number], string> = {
  development: "Development",
  ntp: "NTP",
  cod: "CoD",
  handover: "Handover",
};

const STANDARD_DEPARTMENTS = [
  "engineering",
  "procurement",
  "construction",
  "hse",
  "finance",
] as const;

export type CreateProjectResult = { id: string; code: string };

export const createProject = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => {
    // Re-validate with the archetype-aware full schema for MWh gating.
    const base = createProjectInput.parse(input);
    makeCreateProjectSchema(base.archetype).parse(base);
    return base;
  })
  .handler(async ({ data, context }): Promise<CreateProjectResult> => {
    requireSupabaseAuth(context);

    // --- Auth gate: company_admin OR project_admin ---
    const { data: isCoAdmin, error: coErr } = await context.supabase.rpc(
      "has_company_role",
      { p_role: "company_admin" },
    );
    if (coErr) throw coErr;
    const { data: isProjAdmin, error: paErr } = await context.supabase.rpc(
      "has_company_role",
      { p_role: "project_admin" },
    );
    if (paErr) throw paErr;
    if (!(isCoAdmin === true || isProjAdmin === true)) httpError(403, "forbidden");

    // --- Green H₂ module gate ---
    if (data.archetype === "green_hydrogen") {
      const { data: gh, error: ghErr } = await context.supabase.rpc(
        "has_module_access",
        { p_company_id: data.companyId, p_module: "green_hydrogen" },
      );
      if (ghErr) throw ghErr;
      if (gh !== true) httpError(403, "green_hydrogen_disabled");
    }

    // --- Load template (server-side, don't trust client copy) ---
    let templateGates: Gate[] = [];
    let templateDepts: string[] = [];
    if (data.template_id) {
      const { data: tpl, error: tplErr } = await context.supabase
        .from("project_templates")
        .select("default_gates, default_departments, company_id, archetype")
        .eq("id", data.template_id)
        .maybeSingle();
      if (tplErr) throw tplErr;
      if (!tpl) httpError(404, "template_not_found");
      if (tpl.company_id !== data.companyId) httpError(403, "template_forbidden");
      if (tpl.archetype !== data.archetype) httpError(400, "template_archetype_mismatch");
      const gp = z.array(gateSchema).safeParse(tpl.default_gates);
      const dp = z.array(DEPT_ENUM).safeParse(tpl.default_departments);
      if (gp.success) templateGates = gp.data;
      if (dp.success) templateDepts = dp.data;
    }

    // --- Insert projects row ---
    const { data: proj, error: projErr } = await context.supabase
      .from("projects")
      .insert({
        company_id: data.companyId,
        name: data.name,
        code: data.code,
        archetype: data.archetype,
        phase: "development",
        status: "active",
        capacity_mw: data.capacity_mw,
        capacity_mwh: data.capacity_mwh ?? null,
        site_name: data.site_name || null,
        site_country: data.site_country || null,
        site_region: data.site_region || null,
        site_lat: data.site_lat ?? null,
        site_lng: data.site_lng ?? null,
        offtaker: data.offtaker || null,
        target_cod: data.target_cod.toISOString().slice(0, 10),
        template_id: data.template_id,
        project_admin_id: data.project_admin_id,
        created_by: context.user.id,
      })
      .select("id, code")
      .single();
    if (projErr) {
      // Friendly message for the unique(company_id, code) backstop.
      const msg = /duplicate key.*projects_company_id_code_key/i.test(
        projErr.message,
      )
        ? `A project with code ${data.code} already exists.`
        : projErr.message;
      throw new Error(msg);
    }

    const projectId = proj.id;

    // --- Members: admin + others (dedupe, include any dept leads not in list) ---
    const memberIds = new Set<string>(data.member_ids);
    memberIds.delete(data.project_admin_id);
    for (const key of DEPT_LEAD_ROLES) {
      const uid = (data.dept_leads as Partial<Record<DeptLeadKey, string>>)[key];
      if (uid && uid !== data.project_admin_id) memberIds.add(uid);
    }

    const memberRows: Array<{
      company_id: string;
      project_id: string;
      user_id: string;
      project_role: string;
      created_by: string;
    }> = [
      {
        company_id: data.companyId,
        project_id: projectId,
        user_id: data.project_admin_id,
        project_role: "admin",
        created_by: context.user.id,
      },
      ...Array.from(memberIds).map((uid) => ({
        company_id: data.companyId,
        project_id: projectId,
        user_id: uid,
        project_role: "member",
        created_by: context.user.id,
      })),
    ];

    const { error: memErr } = await context.supabase
      .from("project_members")
      .insert(memberRows);
    if (memErr) throw new Error(memErr.message);

    // --- Departments ---
    const depts =
      templateDepts.length > 0
        ? (templateDepts as ReadonlyArray<(typeof STANDARD_DEPARTMENTS)[number] | string>)
        : STANDARD_DEPARTMENTS;
    const deptRows = depts.map((dept) => ({
      company_id: data.companyId,
      project_id: projectId,
      department: dept as (typeof PROJECT_DEPARTMENTS)[number],
      lead_user_id:
        (data.dept_leads as Partial<Record<string, string>>)[dept as string] ??
        null,
      status: "not_started",
    }));
    const { error: deptErr } = await context.supabase
      .from("project_departments")
      .insert(deptRows);
    if (deptErr) throw new Error(deptErr.message);

    // --- Phase gates: one per phase, checklist from template items ---
    const gatesByPhase = new Map<string, Array<{ name: string; sort_order: number }>>();
    for (const g of templateGates) {
      const arr = gatesByPhase.get(g.phase) ?? [];
      arr.push({ name: g.name, sort_order: g.sort_order });
      gatesByPhase.set(g.phase, arr);
    }
    const gateRows = PROJECT_PHASES.map((phase, idx) => ({
      company_id: data.companyId,
      project_id: projectId,
      phase,
      name: PHASE_LABELS_SHORT[phase],
      sort_order: idx + 1,
      status: idx === 0 ? "open" : "locked",
      checklist: (gatesByPhase.get(phase) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((it) => ({ name: it.name, done: false })),
    }));
    const { error: gateErr } = await context.supabase
      .from("project_phase_gates")
      .insert(gateRows);
    if (gateErr) throw new Error(gateErr.message);

    // --- Audit ---
    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "project.created",
      p_entity: "projects",
      p_entity_id: projectId,
      p_metadata: {
        archetype: data.archetype,
        template_id: data.template_id,
        member_count: memberRows.length,
      },
    });
    if (auditErr) throw new Error(auditErr.message);

    return { id: projectId, code: proj.code };
  });

// ---------------------------------------------------------------------------
// Lightweight project summary for the placeholder detail page.
// ---------------------------------------------------------------------------

const summaryInput = z.object({ id: z.string().uuid() });

export type ProjectSummary = {
  id: string;
  name: string;
  code: string;
  archetype: ProjectArchetype;
  phase: string;
  status: string;
};

export const getProjectSummary = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => summaryInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectSummary | null> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("projects")
      .select("id, name, code, archetype, phase, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      archetype: row.archetype as ProjectArchetype,
      phase: row.phase,
      status: row.status,
    };
  });

