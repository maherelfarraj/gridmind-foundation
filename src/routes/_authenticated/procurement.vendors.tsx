// P-061 — Procurement > Vendors layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/vendors")({
  component: () => <Outlet />,
});
