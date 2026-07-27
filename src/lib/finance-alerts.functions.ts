// P-199 — Finance alerts server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  AlertActionSchema,
  ListAlertsSchema,
  SaveAlertRuleSchema,
  type FinanceAlertAccess,
} from "@/lib/finance-alerts.rules";
import {
  assertAlertRead,
  assertAlertWrite,
  listAlertRules,
  listAlerts,
  resolveAlertAccess,
  saveAlertRule,
  transitionAlert,
  type FinanceAlertRow,
  type FinanceAlertRuleRow,
} from "@/lib/finance-alerts.server";

export const getFinanceAlertAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceAlertAccess> => {
    requireSupabaseAuth(context);
    return resolveAlertAccess(context);
  });

export const getFinanceAlerts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListAlertsSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ alerts: FinanceAlertRow[]; rules: FinanceAlertRuleRow[] }> => {
      requireSupabaseAuth(context);
      assertAlertRead(await resolveAlertAccess(context));
      const [alerts, rules] = await Promise.all([
        listAlerts(context, data),
        listAlertRules(context),
      ]);
      return { alerts, rules };
    },
  );

export const actOnFinanceAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => AlertActionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    requireSupabaseAuth(context);
    assertAlertWrite(await resolveAlertAccess(context));
    return { status: await transitionAlert(context, data.alert_id, data.action) };
  });

export const saveFinanceAlertRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SaveAlertRuleSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    assertAlertWrite(await resolveAlertAccess(context));
    return { id: await saveAlertRule(context, data) };
  });
