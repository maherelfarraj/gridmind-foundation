// POL-2 — Dashboard server function (thin wrapper).
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { loadDashboard, type DashboardData } from "@/lib/dashboard.server";

export type { DashboardData };

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    requireSupabaseAuth(context);
    return loadDashboard(context);
  });
