// P-033 — Project wizard step 1: archetype picker.
// The wizard is driven by ?step=1..4 and a sessionStorage draft.
// No DB writes; final creation gate is P-036.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { z } from "zod";

import { useActiveCompany } from "@/components/company-switcher";
import {
  ArchetypePicker,
  ArchetypePickerSkeleton,
} from "@/components/wizard/archetype-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getProjectCreationAccess } from "@/lib/projects.functions";
import { useProjectDraft, type ProjectArchetype } from "@/lib/wizard-draft";

const searchSchema = z.object({
  step: z.coerce.number().int().min(1).max(4).catch(1).default(1),
  forceError: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/_authenticated/projects/new")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "New project — GridMind EPC" },
      {
        name: "description",
        content:
          "Start a new EPC project by picking an archetype: utility PV, BESS, wind, hybrid, C&I rooftop, transmission substation, or Green H₂.",
      },
      { property: "og:title", content: "New project — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Kick off a new renewable-energy EPC project in GridMind. Pick from seven archetypes covering the full portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { activeCompanyId } = useActiveCompany();
  const { draft, setDraft, clear, hydrated } = useProjectDraft();

  const getAccessFn = useServerFn(getProjectCreationAccess);

  const accessQuery = useQuery({
    queryKey: ["project-creation-access", activeCompanyId, search.forceError],
    queryFn: async () => {
      if (search.forceError) {
        throw new Error("Simulated failure — remove ?forceError=1 to retry.");
      }
      return getAccessFn({ data: { companyId: activeCompanyId! } });
    },
    enabled: !!activeCompanyId,
    retry: false,
  });

  const handleSelect = (archetype: ProjectArchetype) => {
    setDraft({ archetype });
  };

  const handleNext = () => {
    if (!draft.archetype) return;
    void navigate({ to: "/projects/new", search: { step: 2 } });
  };

  const handleCancel = () => {
    clear();
    void navigate({ to: "/" });
  };

  const currentStep = Math.min(4, Math.max(1, search.step));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {currentStep} of 4
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          New project
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick the archetype that best describes what you&apos;re building. It
          drives the templates, configuration, and lifecycle we&apos;ll set up
          for you.
        </p>
      </header>

      {!activeCompanyId || !hydrated || accessQuery.isPending ? (
        <ArchetypePickerSkeleton />
      ) : accessQuery.isError ? (
        <Card className="flex flex-col gap-4 border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-destructive">
              <AlertTriangle size={20} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <div className="font-medium text-foreground">
                Could not load project options
              </div>
              <p className="text-sm text-muted-foreground">
                {accessQuery.error instanceof Error
                  ? accessQuery.error.message
                  : "Unexpected error"}
              </p>
            </div>
          </div>
          <div>
            <Button
              variant="outline"
              onClick={() => void accessQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <ArchetypePicker
          planTier={accessQuery.data.planTier}
          greenHydrogenEnabled={accessQuery.data.greenHydrogenEnabled}
          value={draft.archetype}
          onChange={handleSelect}
        />
      )}

      <footer className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
        <Button onClick={handleNext} disabled={!draft.archetype}>
          Next
          <ArrowRight size={16} aria-hidden />
        </Button>
      </footer>
    </div>
  );
}
