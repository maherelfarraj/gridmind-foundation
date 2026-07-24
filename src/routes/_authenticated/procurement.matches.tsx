// P-067 — Three-way matches layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/matches")({
  component: () => <Outlet />,
});
