// P-053 — Drawings sub-route layout (renders Outlet under engineering).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/drawings")({
  component: () => <Outlet />,
});
