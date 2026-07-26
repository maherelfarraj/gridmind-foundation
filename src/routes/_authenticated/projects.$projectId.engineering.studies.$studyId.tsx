// P-169 — Existing study workspace (input → results → review → revisions → report).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EaStudyWorkspace } from "@/components/engineering/ea-study-workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getEaStudy } from "@/lib/ea-studies.functions";
import { isCalculatorStudyType, type CalculatorStudyType } from "@/lib/electrical";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/studies/$studyId",
)({
  head: () => ({
    meta: [
      { title: "Electrical study — GridMind EPC" },
      {
        name: "description",
        content:
          "Inputs, results, warnings, method, approval trail and revision history for one electrical analysis record.",
      },
      { property: "og:title", content: "Electrical study — GridMind EPC" },
      {
        property: "og:description",
        content: "Reviewable electrical study record with a branded engineering report export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudyDetailPage,
});

function StudyDetailPage() {
  const { projectId, studyId } = Route.useParams();
  const getStudyFn = useServerFn(getEaStudy);
  const query = useQuery({
    queryKey: ["ea-study", studyId],
    queryFn: () => getStudyFn({ data: { studyId } }),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const studyType = query.data?.study.study_type;
  if (!studyType || !isCalculatorStudyType(studyType)) {
    return (
      <EmptyState
        title="This study has no wired calculator"
        description="Protection schedules and grid-code checklists are edited in their own worksheets."
      />
    );
  }

  return (
    <EaStudyWorkspace
      projectId={projectId}
      studyId={studyId}
      studyType={studyType as CalculatorStudyType}
    />
  );
}
