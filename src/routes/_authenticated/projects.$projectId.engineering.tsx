import { createFileRoute } from "@tanstack/react-router";
import { DepartmentPlaceholder } from "@/components/projects/department-placeholder";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering",
)({
  component: Tab,
});

function Tab() {
  const { projectId } = Route.useParams();
  return <DepartmentPlaceholder projectId={projectId} department="engineering" />;
}
