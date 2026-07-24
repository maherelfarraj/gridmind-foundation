// P-063 — Procurement > RFQs layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/rfqs")({
  component: () => <Outlet />,
});
