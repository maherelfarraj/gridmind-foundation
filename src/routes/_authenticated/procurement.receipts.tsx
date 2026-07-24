// P-066 — Procurement > Goods Receipts layout route.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/procurement/receipts")({
  component: () => <Outlet />,
});
