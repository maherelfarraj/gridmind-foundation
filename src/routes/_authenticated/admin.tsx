import { createFileRoute, Outlet, notFound } from "@tanstack/react-router";

import { getCurrentUserRoles } from "@/lib/user-roles.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const roles = await getCurrentUserRoles();
    const isSuperAdmin = roles.some((r) => r.role === "super_admin");
    if (!isSuperAdmin) throw notFound();
    return { isSuperAdmin: true as const };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return <Outlet />;
}
