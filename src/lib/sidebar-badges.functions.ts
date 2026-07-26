// P-SIDEBAR — badge rollup counts for the grouped sidebar (thin wrapper).
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  criticalAlarmCount,
  openCategoryAPunchCount,
  sidebarCompanyId,
} from "@/lib/sidebar-badges.server";

export const getSidebarBadgeCounts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ criticalAlarms: number; openPunchA: number }> => {
    requireSupabaseAuth(context);
    const companyId = await sidebarCompanyId(context);
    if (!companyId) return { criticalAlarms: 0, openPunchA: 0 };
    const [criticalAlarms, openPunchA] = await Promise.all([
      criticalAlarmCount(context, companyId),
      openCategoryAPunchCount(context, companyId),
    ]);
    return { criticalAlarms, openPunchA };
  });
