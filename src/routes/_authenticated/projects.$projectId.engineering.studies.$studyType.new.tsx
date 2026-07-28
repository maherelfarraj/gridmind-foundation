// P-169 — New study workspace for a chosen calculator type.
import { createFileRoute, Link } from "@tanstack/react-router";

import { EaStudyWorkspace } from "@/components/engineering/ea-study-workspace";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { isCalculatorStudyType, type CalculatorStudyType } from "@/lib/electrical";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/studies/$studyType/new",
)({
  head: () => ({
    meta: [
      { title: "New electrical study — GridMind EPC" },
      {
        name: "description",
        content:
          "Run a load-flow, short-circuit, sizing or power-quality calculation and save it as a numbered, reviewable engineering record.",
      },
      { property: "og:title", content: "New electrical study — GridMind EPC" },
      {
        property: "og:description",
        content: "Calculate, document and submit an electrical study for engineering review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewStudyPage,
});

function NewStudyPage() {
  const { t } = useI18n();
  const { projectId, studyType } = Route.useParams();

  if (!isCalculatorStudyType(studyType)) {
    return (
      <EmptyState
        title={t("engMod.ea.studies.noCalculator.title")}
        description={t("engMod.ea.studies.noCalculator.description")}
        action={
          <Button asChild variant="outline">
            <Link to="/projects/$projectId/engineering/studies" params={{ projectId }}>
              {t("engMod.ea.studies.noCalculator.backToStudies")}
            </Link>
          </Button>
        }
      />
    );
  }

  return <EaStudyWorkspace projectId={projectId} studyType={studyType as CalculatorStudyType} />;
}
