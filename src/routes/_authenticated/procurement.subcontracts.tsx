// P-258 — Subcontracts layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/subcontracts")({
  component: () => <Outlet />,
});
