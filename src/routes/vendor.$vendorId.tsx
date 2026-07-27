// P-223 — Vendor account layout (dashboard + dedicated module pages).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/vendor/$vendorId")({
  component: () => <Outlet />,
});
