import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";

const searchSchema = z.object({
  redirect: z
    .string()
    .refine((v) => v.startsWith("/") && !v.startsWith("//"), {
      message: "redirect must be a same-origin path",
    })
    .optional(),
});

export const Route = createFileRoute("/(auth)")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async ({ location, search }) => {
    if (location.pathname === "/reset-password") return;
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      throw redirect({ to: search.redirect ?? "/" });
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
