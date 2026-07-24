// Module access RPCs (P-027). All calls run through requireSupabaseAuth.
// Writes are super_admin only, enforced server-side via public.has_role().
// Every toggle is audited via public.write_audit_log; downgrades that
// disable green_hydrogen are handled inside updateTenantPlan.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  MODULE_KEYS,
  MODULE_REGISTRY,
  planAllowsModule,
  type ModuleKey,
} from "./modules";
import type { PlanTier } from "./permissions";

const uuidSchema = z.string().uuid();
const moduleSchema = z.enum(MODULE_KEYS);

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function isSuperAdmin(
  context: AuthContext & { user: NonNullable<AuthContext["user"]> },
): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    p_user_id: context.user.id,
    p_role: "super_admin",
  });
  if (error) throw error;
  return data === true;
}

async function isCompanyMember(
  context: AuthContext & { user: NonNullable<AuthContext["user"]> },
  companyId: string,
): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id")
    .eq("id", context.user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

export type ModuleAccessRow = {
  key: ModuleKey;
  label: string;
  description: string;
  baselinePlans: PlanTier[];
  enterpriseOnly: boolean;
  enabled: boolean;
  source: "override" | "baseline";
  allowedByPlan: boolean;
};

export type ModuleAccessResult = {
  companyId: string;
  planTier: PlanTier;
  canEdit: boolean;
  modules: ModuleAccessRow[];
};

export const listModuleAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: uuidSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ModuleAccessResult> => {
    requireSupabaseAuth(context);

    const superAdmin = await isSuperAdmin(context);
    if (!superAdmin) {
      const member = await isCompanyMember(context, data.companyId);
      if (!member) httpError(403, "forbidden");
    }

    const { data: company, error: coErr } = await context.supabase
      .from("companies")
      .select("plan_tier")
      .eq("id", data.companyId)
      .maybeSingle();
    if (coErr) throw coErr;
    if (!company) httpError(404, "tenant_not_found");

    const planTier = company.plan_tier as PlanTier;

    const { data: overrides, error: ovErr } = await context.supabase
      .from("module_access_rules")
      .select("module, enabled")
      .eq("company_id", data.companyId);
    if (ovErr) throw ovErr;

    const overrideMap = new Map<string, boolean>();
    for (const row of overrides ?? []) overrideMap.set(row.module, row.enabled);

    const modules: ModuleAccessRow[] = MODULE_KEYS.map((key) => {
      const def = MODULE_REGISTRY[key];
      const allowedByPlan = planAllowsModule(planTier, key);
      const override = overrideMap.get(key);
      const baseline = allowedByPlan;
      // Mirror has_module_access: override wins unless green_hydrogen on
      // non-enterprise (in which case it is force-disabled).
      let enabled: boolean;
      let source: "override" | "baseline";
      if (def.enterpriseOnly && planTier !== "enterprise") {
        enabled = false;
        source = override !== undefined ? "override" : "baseline";
      } else if (override !== undefined) {
        enabled = override;
        source = "override";
      } else {
        enabled = baseline;
        source = "baseline";
      }
      return {
        key,
        label: def.label,
        description: def.description,
        baselinePlans: [...def.baselinePlans],
        enterpriseOnly: def.enterpriseOnly,
        enabled,
        source,
        allowedByPlan,
      };
    });

    return {
      companyId: data.companyId,
      planTier,
      canEdit: superAdmin,
      modules,
    };
  });

export const setModuleAccess = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        companyId: uuidSchema,
        module: moduleSchema,
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await isSuperAdmin(context))) httpError(403, "forbidden");

    const { data: company, error: coErr } = await context.supabase
      .from("companies")
      .select("plan_tier")
      .eq("id", data.companyId)
      .maybeSingle();
    if (coErr) throw coErr;
    if (!company) httpError(404, "tenant_not_found");

    const planTier = company.plan_tier as PlanTier;
    if (data.enabled && !planAllowsModule(planTier, data.module)) {
      httpError(
        403,
        "plan_gated",
        MODULE_REGISTRY[data.module].enterpriseOnly
          ? "Green H₂ requires the Enterprise plan."
          : `Plan tier ${planTier} does not include ${data.module}.`,
      );
    }

    const { error: upErr } = await context.supabase
      .from("module_access_rules")
      .upsert(
        {
          company_id: data.companyId,
          module: data.module,
          enabled: data.enabled,
        },
        { onConflict: "company_id,module" },
      );
    if (upErr) throw upErr;

    const { error: auditErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "module_access.changed",
      p_entity: "module_access_rules",
      p_entity_id: data.companyId,
      p_metadata: {
        module_key: data.module,
        enabled: data.enabled,
        company_id: data.companyId,
        actor: context.user.id,
      },
    });
    if (auditErr) throw auditErr;

    return { ok: true, module: data.module, enabled: data.enabled };
  });
