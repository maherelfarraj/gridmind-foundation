// P-033 — Project creation gating.
// Returns the active company's plan tier and whether the green_hydrogen
// module is enabled. UI uses this to decide whether the Green H₂ archetype
// card is selectable. The final creation gate (P-036) re-checks server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
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

    const { data: member, error: memberErr } = await context.supabase.rpc("is_company_member", {
      p_company_id: data.companyId,
    });
    if (memberErr) throw memberErr;
    if (member !== true) httpError(403, "forbidden");

    const { data: company, error: coErr } = await context.supabase
      .from("companies")
      .select("plan_tier")
      .eq("id", data.companyId)
      .maybeSingle();
    if (coErr) throw coErr;
    if (!company) httpError(404, "tenant_not_found");

    const { data: hasAccess, error: modErr } = await context.supabase.rpc("has_module_access", {
      p_company_id: data.companyId,
      p_module: "green_hydrogen",
    });
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

    const { data: member, error: memberErr } = await context.supabase.rpc("is_company_member", {
      p_company_id: data.companyId,
    });
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
    out.sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
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
    list.sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
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
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,12}$/),
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
  cod: "COD",
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
    const { data: isCoAdmin, error: coErr } = await context.supabase.rpc("has_company_role", {
      p_role: "company_admin",
    });
    if (coErr) throw coErr;
    const { data: isProjAdmin, error: paErr } = await context.supabase.rpc("has_company_role", {
      p_role: "project_admin",
    });
    if (paErr) throw paErr;
    if (!(isCoAdmin === true || isProjAdmin === true)) httpError(403, "forbidden");

    // --- Green H₂ module gate ---
    if (data.archetype === "green_hydrogen") {
      const { data: gh, error: ghErr } = await context.supabase.rpc("has_module_access", {
        p_company_id: data.companyId,
        p_module: "green_hydrogen",
      });
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
      const msg = /duplicate key.*projects_company_id_code_key/i.test(projErr.message)
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

    const { error: memErr } = await context.supabase.from("project_members").insert(memberRows);
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
      lead_user_id: (data.dept_leads as Partial<Record<string, string>>)[dept as string] ?? null,
      status: "not_started",
    }));
    const { error: deptErr } = await context.supabase.from("project_departments").insert(deptRows);
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
      checklist: [
        ...(gatesByPhase.get(phase) ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((it) => ({ name: it.name, done: false })),
        ...(phase === "development"
          ? [
              {
                key: "design_freeze",
                label: "Design freeze — IFC package released",
                required: true,
                done: false,
              },
            ]
          : []),
      ],
    }));
    const { error: gateErr } = await context.supabase.from("project_phase_gates").insert(gateRows);
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

// ---------------------------------------------------------------------------
// P-037 — Project cockpit list + CSV export.
// ---------------------------------------------------------------------------

const PHASE_ENUM = z.enum(PROJECT_PHASES);

const listProjectsInput = z.object({
  companyId: z.string().uuid(),
  search: z.string().trim().max(120).optional(),
  phase: PHASE_ENUM.optional(),
  archetype: ARCHETYPE_ENUM.optional(),
  department: DEPT_ENUM.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ProjectCardRow = {
  id: string;
  name: string;
  code: string;
  archetype: ProjectArchetype;
  phase: (typeof PROJECT_PHASES)[number];
  status: string;
  capacity_mw: number | null;
  capacity_mwh: number | null;
  site_country: string | null;
  target_cod: string | null;
  project_admin: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
};

export type ListProjectsResult = {
  rows: ProjectCardRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 24;

function escapeIlike(v: string): string {
  // Escape PostgREST .or() delimiter + LIKE wildcards.
  return v.replace(/[,%_]/g, (c) => `\\${c}`);
}

async function assertCompanyMember(
  supabase: { rpc: (fn: any, args: any) => any },
  companyId: string,
): Promise<void> {
  const { data: ok, error } = await supabase.rpc("is_company_member", {
    p_company_id: companyId,
  });
  if (error) throw error;
  if (ok !== true) httpError(403, "forbidden");
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listProjectsInput.parse(input))
  .handler(async ({ data, context }): Promise<ListProjectsResult> => {
    requireSupabaseAuth(context);
    await assertCompanyMember(context.supabase, data.companyId);

    // Department semi-join: prefetch project ids that have the requested dept.
    let deptIdFilter: string[] | null = null;
    if (data.department) {
      const { data: deptRows, error: deptErr } = await context.supabase
        .from("project_departments")
        .select("project_id")
        .eq("department", data.department);
      if (deptErr) throw deptErr;
      deptIdFilter = Array.from(new Set((deptRows ?? []).map((r) => r.project_id as string)));
      if (deptIdFilter.length === 0) {
        return { rows: [], total: 0, page: data.page, pageSize: PAGE_SIZE };
      }
    }

    let q = context.supabase
      .from("projects")
      .select(
        "id, name, code, archetype, phase, status, capacity_mw, capacity_mwh, site_country, target_cod, project_admin:profiles!projects_project_admin_id_fkey(id, full_name, email, avatar_url)",
        { count: "exact" },
      )
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });

    if (data.phase) q = q.eq("phase", data.phase);
    if (data.archetype) q = q.eq("archetype", data.archetype);
    if (deptIdFilter) q = q.in("id", deptIdFilter);
    if (data.search && data.search.length > 0) {
      const s = escapeIlike(data.search);
      q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%`);
    }

    const from = (data.page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error, count } = await q.range(from, to);
    if (error) throw error;

    return {
      rows: (rows ?? []) as unknown as ProjectCardRow[],
      total: count ?? 0,
      page: data.page,
      pageSize: PAGE_SIZE,
    };
  });

// TODO(Batch 12): consult project_export_locks before returning CSV.
const exportCsvInput = listProjectsInput.omit({ page: true });

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportProjectsCsv = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => exportCsvInput.parse(input))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    await assertCompanyMember(context.supabase, data.companyId);

    let deptIdFilter: string[] | null = null;
    if (data.department) {
      const { data: deptRows, error: deptErr } = await context.supabase
        .from("project_departments")
        .select("project_id")
        .eq("department", data.department);
      if (deptErr) throw deptErr;
      deptIdFilter = Array.from(new Set((deptRows ?? []).map((r) => r.project_id as string)));
      if (deptIdFilter.length === 0) {
        return {
          filename: `projects-${new Date().toISOString()}.csv`,
          csv: buildCsv([]),
        };
      }
    }

    let q = context.supabase
      .from("projects")
      .select(
        "code, name, archetype, phase, status, capacity_mw, capacity_mwh, site_country, target_cod, project_admin:profiles!projects_project_admin_id_fkey(full_name, email)",
      )
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (data.phase) q = q.eq("phase", data.phase);
    if (data.archetype) q = q.eq("archetype", data.archetype);
    if (deptIdFilter) q = q.in("id", deptIdFilter);
    if (data.search && data.search.length > 0) {
      const s = escapeIlike(data.search);
      q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    return {
      filename: `projects-${new Date().toISOString().slice(0, 19)}.csv`,
      csv: buildCsv((rows ?? []) as any[]),
    };
  });

function buildCsv(rows: any[]): string {
  const header = [
    "code",
    "name",
    "archetype",
    "phase",
    "status",
    "capacity_mw",
    "capacity_mwh",
    "site_country",
    "target_cod",
    "project_admin",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const admin = r.project_admin ? r.project_admin.full_name || r.project_admin.email || "" : "";
    lines.push(
      [
        r.code,
        r.name,
        r.archetype,
        r.phase,
        r.status,
        r.capacity_mw,
        r.capacity_mwh,
        r.site_country,
        r.target_cod,
        admin,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// P-038 — Full project detail (header + tabs + stepper).
// ---------------------------------------------------------------------------

const projectDetailInput = z.object({ id: z.string().uuid() });

export type ProjectDetailMember = {
  id: string;
  user_id: string;
  project_role: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type ProjectDetailDepartment = {
  id: string;
  department: ProjectDepartment;
  status: string;
  lead_user_id: string | null;
  lead_name: string | null;
};

export type GateChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  done_by?: string | null;
  done_at?: string | null;
  done_by_name?: string | null;
  /** POL-5 — operational metadata. */
  owner_id?: string | null;
  owner_name?: string | null;
  due_date?: string | null;
  evidence_label?: string | null;
  evidence_url?: string | null;
};

export type ProjectDetailGate = {
  id: string;
  phase: (typeof PROJECT_PHASES)[number];
  name: string;
  status: string;
  sort_order: number;
  checklist: GateChecklistItem[];
  approval_instance_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval?: {
    instance_id: string;
    instance_status: string;
    my_approval_id: string | null;
    my_approval_status: string | null;
  } | null;
};

export type ProjectDetail = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  archetype: ProjectArchetype;
  phase: (typeof PROJECT_PHASES)[number];
  status: string;
  capacity_mw: number | null;
  capacity_mwh: number | null;
  site_name: string | null;
  site_country: string | null;
  site_region: string | null;
  offtaker: string | null;
  target_cod: string | null;
  description: string | null;
  project_admin_id: string | null;
  caller_roles: string[];
  members: ProjectDetailMember[];
  departments: ProjectDetailDepartment[];
  gates: ProjectDetailGate[];
};

export const getProject = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectDetailInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectDetail | null> => {
    requireSupabaseAuth(context);

    const { data: proj, error } = await context.supabase
      .from("projects")
      .select(
        "id, company_id, name, code, archetype, phase, status, capacity_mw, capacity_mwh, site_name, site_country, site_region, offtaker, target_cod, description, project_admin_id",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!proj) return null;

    const [rolesRes, membersRes, deptsRes, gatesRes] = await Promise.all([
      context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.user.id)
        .eq("company_id", proj.company_id),
      context.supabase
        .from("project_members")
        .select(
          "id, user_id, project_role, profiles:profiles!project_members_user_id_fkey(full_name, email, avatar_url)",
        )
        .eq("project_id", proj.id),
      context.supabase
        .from("project_departments")
        .select(
          "id, department, status, lead_user_id, lead:profiles!project_departments_lead_user_id_fkey(full_name)",
        )
        .eq("project_id", proj.id),
      context.supabase
        .from("project_phase_gates")
        .select(
          "id, phase, name, status, sort_order, checklist, approval_instance_id, approved_by, approved_at",
        )
        .eq("project_id", proj.id)
        .order("sort_order", { ascending: true }),
    ]);

    if (rolesRes.error) throw rolesRes.error;
    if (membersRes.error) throw membersRes.error;
    if (deptsRes.error) throw deptsRes.error;
    if (gatesRes.error) throw gatesRes.error;

    const members: ProjectDetailMember[] = (membersRes.data ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      project_role: m.project_role,
      full_name: m.profiles?.full_name ?? null,
      email: m.profiles?.email ?? null,
      avatar_url: m.profiles?.avatar_url ?? null,
    }));

    const departments: ProjectDetailDepartment[] = (deptsRes.data ?? []).map((d: any) => ({
      id: d.id,
      department: d.department as ProjectDepartment,
      status: d.status,
      lead_user_id: d.lead_user_id,
      lead_name: d.lead?.full_name ?? null,
    }));

    const gateRows = (gatesRes.data ?? []) as any[];

    // Collect done_by / owner ids to resolve names
    const stampIds = new Set<string>();
    for (const g of gateRows) {
      const items = Array.isArray(g.checklist) ? g.checklist : [];
      for (const it of items) {
        if (it?.done_by) stampIds.add(it.done_by);
        if (it?.owner_id) stampIds.add(it.owner_id);
      }
    }

    const namesById: Record<string, string | null> = {};
    if (stampIds.size > 0) {
      const { data: ppl } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(stampIds));
      for (const p of (ppl ?? []) as Array<{ id: string; full_name: string | null }>) {
        namesById[p.id] = p.full_name;
      }
    }

    // Resolve caller approval rows for any in_review gates
    const inReviewInstanceIds = gateRows
      .filter((g) => g.status === "in_review" && g.approval_instance_id)
      .map((g) => g.approval_instance_id as string);
    const myApprovals: Record<
      string,
      { my_approval_id: string; my_approval_status: string; instance_status: string }
    > = {};
    if (inReviewInstanceIds.length > 0) {
      const { data: apRows } = await context.supabase
        .from("approvals")
        .select("id, instance_id, status, approver_id")
        .in("instance_id", inReviewInstanceIds)
        .eq("approver_id", context.user.id);
      const { data: instRows } = await context.supabase
        .from("approval_instances")
        .select("id, status")
        .in("id", inReviewInstanceIds);
      const instStatus: Record<string, string> = {};
      for (const i of (instRows ?? []) as Array<{ id: string; status: string }>) {
        instStatus[i.id] = i.status;
      }
      for (const a of (apRows ?? []) as Array<{
        id: string;
        instance_id: string;
        status: string;
      }>) {
        myApprovals[a.instance_id] = {
          my_approval_id: a.id,
          my_approval_status: a.status,
          instance_status: instStatus[a.instance_id] ?? "pending",
        };
      }
    }

    const gates: ProjectDetailGate[] = gateRows.map((g: any) => {
      const rawList: any[] = Array.isArray(g.checklist) ? g.checklist : [];
      const checklist: GateChecklistItem[] = rawList.map((it: any) => ({
        key: String(it?.key ?? ""),
        label: String(it?.label ?? it?.name ?? ""),
        required: it?.required !== false,
        done: !!it?.done,
        done_by: it?.done_by ?? null,
        done_at: it?.done_at ?? null,
        done_by_name: it?.done_by ? (namesById[it.done_by] ?? null) : null,
        owner_id: it?.owner_id ?? null,
        owner_name: it?.owner_id ? (namesById[it.owner_id] ?? null) : null,
        due_date: it?.due_date ?? null,
        evidence_label: it?.evidence_label ?? null,
        evidence_url: it?.evidence_url ?? null,
      }));
      const approvalInfo =
        g.approval_instance_id && myApprovals[g.approval_instance_id]
          ? {
              instance_id: g.approval_instance_id as string,
              instance_status: myApprovals[g.approval_instance_id].instance_status,
              my_approval_id: myApprovals[g.approval_instance_id].my_approval_id,
              my_approval_status: myApprovals[g.approval_instance_id].my_approval_status,
            }
          : g.approval_instance_id
            ? {
                instance_id: g.approval_instance_id as string,
                instance_status: "pending",
                my_approval_id: null,
                my_approval_status: null,
              }
            : null;
      return {
        id: g.id,
        phase: g.phase,
        name: g.name,
        status: g.status,
        sort_order: g.sort_order,
        checklist,
        approval_instance_id: g.approval_instance_id ?? null,
        approved_by: g.approved_by ?? null,
        approved_at: g.approved_at ?? null,
        approval: approvalInfo,
      };
    });

    return {
      id: proj.id,
      company_id: proj.company_id,
      name: proj.name,
      code: proj.code,
      archetype: proj.archetype as ProjectArchetype,
      phase: proj.phase as (typeof PROJECT_PHASES)[number],
      status: proj.status,
      capacity_mw: proj.capacity_mw,
      capacity_mwh: proj.capacity_mwh,
      site_name: proj.site_name,
      site_country: proj.site_country,
      site_region: proj.site_region,
      offtaker: proj.offtaker,
      target_cod: proj.target_cod,
      description: proj.description,
      project_admin_id: proj.project_admin_id,
      caller_roles: (rolesRes.data ?? []).map((r: any) => r.role as string),
      members,
      departments,
      gates,
    };
  });

// ---------------------------------------------------------------------------
// P-039 — Archetype configuration reads + writes.
// ---------------------------------------------------------------------------

import {
  ARCHETYPE_CONFIG_KEYS,
  ARCHETYPE_CONFIG_MAP,
  CONFIG_DEFAULTS,
  CONFIG_EDIT_ROLES,
  CONFIG_TABLE_MAP,
  configSchemas,
  type ArchetypeConfigKey,
} from "@/lib/schemas/archetype-configs";

const configKeyEnum = z.enum(ARCHETYPE_CONFIG_KEYS);

const getConfigsInput = z.object({ project_id: z.string().uuid() });

export type ArchetypeConfigsResult = {
  project_id: string;
  archetype: ProjectArchetype;
  rows: Record<ArchetypeConfigKey, Record<string, any> | null>;
  canEdit: Record<ArchetypeConfigKey, boolean>;
};

export const getArchetypeConfigs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => getConfigsInput.parse(input))
  .handler(async ({ data, context }): Promise<ArchetypeConfigsResult | null> => {
    requireSupabaseAuth(context);

    const { data: proj, error } = await context.supabase
      .from("projects")
      .select("id, company_id, archetype")
      .eq("id", data.project_id)
      .maybeSingle();
    if (error) throw error;
    if (!proj) return null;

    const { data: roleRows, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.user.id)
      .eq("company_id", proj.company_id);
    if (roleErr) throw roleErr;
    const roles = new Set((roleRows ?? []).map((r: any) => r.role as string));

    const rowResults = await Promise.all(
      ARCHETYPE_CONFIG_KEYS.map((key) =>
        context.supabase
          .from(CONFIG_TABLE_MAP[key] as any)
          .select("*")
          .eq("project_id", data.project_id)
          .maybeSingle(),
      ),
    );

    const rows = {} as Record<ArchetypeConfigKey, Record<string, any> | null>;
    const canEdit = {} as Record<ArchetypeConfigKey, boolean>;
    ARCHETYPE_CONFIG_KEYS.forEach((key, i) => {
      const res = rowResults[i];
      if (res.error) throw res.error;
      rows[key] = (res.data as Record<string, any> | null) ?? null;
      canEdit[key] = CONFIG_EDIT_ROLES[key].some((r) => roles.has(r));
    });

    return {
      project_id: proj.id,
      archetype: proj.archetype as ProjectArchetype,
      rows,
      canEdit,
    };
  });

const saveConfigInput = z.object({
  project_id: z.string().uuid(),
  config: configKeyEnum,
  values: z.unknown(),
});

export const saveArchetypeConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveConfigInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const configKey = data.config as ArchetypeConfigKey;
    const schema = configSchemas[configKey];
    const parsed = schema.safeParse(data.values ?? CONFIG_DEFAULTS[configKey]);
    if (!parsed.success) {
      throw Object.assign(new Error("invalid_config_values"), {
        statusCode: 400,
        body: JSON.stringify({
          error: "invalid_config_values",
          issues: parsed.error.issues,
        }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const { data: proj, error: projErr } = await context.supabase
      .from("projects")
      .select("id, company_id, archetype")
      .eq("id", data.project_id)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!proj) httpError(404, "project_not_found");

    const allowed = ARCHETYPE_CONFIG_MAP[proj.archetype as ProjectArchetype];
    if (!allowed.includes(configKey)) {
      httpError(403, "config_not_allowed_for_archetype");
    }

    const { data: roleRows, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.user.id)
      .eq("company_id", proj.company_id);
    if (roleErr) throw roleErr;
    const roles = new Set((roleRows ?? []).map((r: any) => r.role as string));
    const requiredRoles = CONFIG_EDIT_ROLES[configKey];
    if (!requiredRoles.some((r) => roles.has(r))) {
      httpError(403, "forbidden");
    }

    const table = CONFIG_TABLE_MAP[configKey];
    const payload: Record<string, any> = {
      ...(parsed.data as Record<string, any>),
      company_id: proj.company_id,
      project_id: proj.id,
    };

    const { data: saved, error: upErr } = await context.supabase
      .from(table as any)
      .upsert(payload, { onConflict: "project_id" })
      .select("*")
      .single();
    if (upErr) throw new Error(upErr.message);

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "project_config.saved",
      p_entity: table,
      p_entity_id: proj.id,
      p_metadata: {
        config: configKey,
        fields: Object.keys(parsed.data as Record<string, any>),
      },
    });
    if (auditErr) throw new Error(auditErr.message);

    return { row: saved as Record<string, any> };
  });
