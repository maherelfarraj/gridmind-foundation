// P-039 — Config tab: archetype-aware sub-tabs backed by shared zod forms.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArchetypeConfigForm } from "@/components/projects/config/archetype-config-form";
import { ThreadLink } from "@/components/thread/thread-link";
import { archetypeConfigsQueryOptions } from "@/lib/archetype-configs-query";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import { ARCHETYPE_CONFIG_MAP, CONFIG_LABELS } from "@/lib/schemas/archetype-configs";

export const Route = createFileRoute("/_authenticated/projects/$projectId/config")({
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(projectDetailQueryOptions(params.projectId));
    context.queryClient.ensureQueryData(archetypeConfigsQueryOptions(params.projectId));
  },
  component: ConfigTab,
});

function ConfigTab() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));
  const { data: configs } = useSuspenseQuery(archetypeConfigsQueryOptions(projectId));

  if (!project || !configs) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          Configuration is unavailable for this project.
        </p>
      </Card>
    );
  }

  const sections = ARCHETYPE_CONFIG_MAP[project.archetype];
  const first = sections[0];

  return (
    <Tabs defaultValue={first} className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ThreadLink entityType="project" entityId={projectId} label="View change impacts" />
      </div>
      <TabsList className="flex flex-wrap gap-1 bg-transparent p-0">
        {sections.map((key) => (
          <TabsTrigger
            key={key}
            value={key}
            className="rounded-md border border-transparent bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            {CONFIG_LABELS[key]}
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map((key) => (
        <TabsContent key={key} value={key} className="m-0">
          <ArchetypeConfigForm
            configKey={key}
            projectId={projectId}
            initial={configs.rows[key]}
            canEdit={configs.canEdit[key]}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
