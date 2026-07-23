import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/(auth)")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Recovery links land on /reset-password with an active session; keep them here.
    if (location.pathname === "/reset-password") return;
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      throw redirect({ to: "/" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="font-display text-2xl font-bold tracking-tight text-foreground">
            GridMind EPC
          </span>
          <p className="text-sm text-muted-foreground">
            The operating system for renewable EPC
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
