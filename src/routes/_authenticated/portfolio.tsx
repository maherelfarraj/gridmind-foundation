// P-252 / GC-08 — Portfolio layout. The overview lives in portfolio.index.tsx;
// Cost & Close lives in portfolio.costing.tsx.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portfolio")({
  component: () => <Outlet />,
});
