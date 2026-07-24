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
import type { PlanTier } from "./permissions";

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
