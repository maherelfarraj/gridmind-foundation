// P-082 — Project finance / PPA index landing (redirects to PPA tab).
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/project-finance/",
)({
  component: RedirectToPpa,
});

function RedirectToPpa() {
  const { projectId } = Route.useParams();
  return (
    <Navigate
      to={"/projects/$projectId/finance/project-finance/ppa" as any}
      params={{ projectId } as any}
      replace
    />
  );
}
