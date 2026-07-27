// P-196 — Finance cockpit server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { GetFinanceCockpitSchema, type FinanceAccessLevel } from "@/lib/finance-cockpit.rules";
import {
  loadFinanceCockpit,
  resolveFinanceAccess,
  type FinanceCockpitData,
} from "@/lib/finance-cockpit.server";
import { httpError } from "@/lib/payments.server";

export type { FinanceCockpitData };

export const getFinanceAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ level: FinanceAccessLevel }> => {
    requireSupabaseAuth(context);
    return { level: await resolveFinanceAccess(context) };
  });

export const getFinanceCockpit = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => GetFinanceCockpitSchema.parse(input ?? {}))
  .handler(async ({ context }): Promise<FinanceCockpitData & { access: FinanceAccessLevel }> => {
    requireSupabaseAuth(context);
    const access = await resolveFinanceAccess(context);
    if (access === "none") httpError(403, "forbidden", "Finance cockpit requires a finance role.");
    const data = await loadFinanceCockpit(context);
    return { ...data, access };
  });
