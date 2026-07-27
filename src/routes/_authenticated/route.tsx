import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }

    // P-222 — external-only accounts never see the internal shell.
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const roleNames = (roles ?? []).map((r) => r.role as string);
    const EXTERNAL_ONLY = new Set(["external_viewer", "vendor_viewer"]);
    if (roleNames.length > 0 && roleNames.every((r) => EXTERNAL_ONLY.has(r))) {
      throw redirect({ to: roleNames.includes("vendor_viewer") ? "/vendor" : "/portal" });
    }

    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
