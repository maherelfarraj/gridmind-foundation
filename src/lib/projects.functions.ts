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
