// P-064 — Procurement > Purchase Orders layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/pos")({
  component: () => <Outlet />,
});
