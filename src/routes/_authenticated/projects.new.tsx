// P-033/P-034/P-035/P-036 — Project wizard: 4 steps + createProject.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useActiveCompany } from "@/components/company-switcher";
import { ArchetypePicker, ArchetypePickerSkeleton } from "@/components/wizard/archetype-picker";
import { ProjectBasicsForm } from "@/components/wizard/project-basics-form";
import { ProjectSelectionForm } from "@/components/wizard/project-selection-form";
import { TeamForm } from "@/components/wizard/team-form";
import { TemplatePickerSkeleton } from "@/components/wizard/template-picker";
import { WizardErrorPanel } from "@/components/wizard/error-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createProject,
  getProjectCreationAccess,
  listActiveCompanyProfiles,
  listEligibleUsers,
  listProjectTemplates,
  type EligibleUser,
} from "@/lib/projects.functions";
import {
  DEPT_LEAD_ROLE_MAP,
  DEPT_LEAD_ROLES,
  type DeptLeadKey,
  type ProjectBasics,
  type ProjectSelection,
  type ProjectTeam,
} from "@/lib/schemas/project-wizard";
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

  const currentStep = Math.min(4, Math.max(1, search.step));

  const getAccessFn = useServerFn(getProjectCreationAccess);
  const listTemplatesFn = useServerFn(listProjectTemplates);
  const listEligibleFn = useServerFn(listEligibleUsers);
  const listProfilesFn = useServerFn(listActiveCompanyProfiles);
  const createProjectFn = useServerFn(createProject);

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

  const templatesQuery = useQuery({
    queryKey: ["project-templates", activeCompanyId, draft.archetype, search.forceError],
    queryFn: async () => {
      if (search.forceError) {
        throw new Error("Simulated failure — remove ?forceError=1 to retry.");
      }
      return listTemplatesFn({
        data: {
          companyId: activeCompanyId!,
          archetype: draft.archetype!,
        },
      });
    },
    enabled: !!activeCompanyId && !!draft.archetype && currentStep === 3,
    retry: false,
  });

  const teamQuery = useQuery({
    queryKey: ["project-team-candidates", activeCompanyId],
    queryFn: async () => {
      const companyId = activeCompanyId!;
      const [admins, profiles, ...leads] = await Promise.all([
        listEligibleFn({ data: { companyId, role: "project_admin" } }),
        listProfilesFn({ data: { companyId } }),
        ...DEPT_LEAD_ROLES.map((k) =>
          listEligibleFn({
            data: { companyId, role: DEPT_LEAD_ROLE_MAP[k] },
          }),
        ),
      ]);
      const deptCandidates = Object.fromEntries(
        DEPT_LEAD_ROLES.map((k, i) => [k, leads[i] as EligibleUser[]]),
      ) as Record<DeptLeadKey, EligibleUser[]>;
      return { admins, profiles, deptCandidates };
    },
    enabled: !!activeCompanyId && currentStep === 4,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (team: ProjectTeam) => {
      const basics = draft.basics!;
      return createProjectFn({
        data: {
          companyId: activeCompanyId!,
          archetype: draft.archetype!,
          template_id: draft.selection?.template_id ?? null,
          name: basics.name,
          code: basics.code,
          capacity_mw: basics.capacity_mw,
          capacity_mwh: basics.capacity_mwh,
          site_name: basics.site_name,
          site_country: basics.site_country,
          site_region: basics.site_region,
          site_lat: basics.site_lat,
          site_lng: basics.site_lng,
          offtaker: basics.offtaker,
          target_cod: basics.target_cod,
          project_admin_id: team.project_admin_id,
          member_ids: team.member_ids,
          dept_leads: team.dept_leads,
        },
      });
    },
    onSuccess: (result) => {
      toast.success("Project created");
      clear();
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: result.id },
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not create project");
    },
  });

  // Redirect to step 1 if a later step is opened without an archetype in the draft.
  useEffect(() => {
    if (!hydrated) return;
    if (currentStep >= 2 && !draft.archetype) {
      void navigate({
        to: "/projects/new",
        search: { step: 1 },
        replace: true,
      });
    }
    if (currentStep >= 3 && !draft.basics) {
      void navigate({
        to: "/projects/new",
        search: { step: 2 },
        replace: true,
      });
    }
    if (currentStep === 4 && !draft.selection) {
      void navigate({
        to: "/projects/new",
        search: { step: 3 },
        replace: true,
      });
    }
  }, [hydrated, currentStep, draft.archetype, draft.basics, draft.selection, navigate]);

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

  const handleBasicsSubmit = (values: ProjectBasics) => {
    setDraft({ basics: values });
    void navigate({ to: "/projects/new", search: { step: 3 } });
  };

  const handleSelectionSubmit = (values: ProjectSelection) => {
    setDraft({ selection: values });
    void navigate({ to: "/projects/new", search: { step: 4 } });
  };

  const handleTeamSubmit = (values: ProjectTeam) => {
    setDraft({ team: values });
    createMutation.mutate(values);
  };

  const stepSubtitle =
    currentStep === 1
      ? "Pick the archetype that best describes what you're building. It drives the templates, configuration, and lifecycle we'll set up for you."
      : currentStep === 2
        ? "Tell us the basics: name, capacity, site, and target COD."
        : currentStep === 3
          ? "Choose a template, then tune the gates, budget, and departments."
          : "Assign the project admin, members, and department leads.";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {currentStep} of 4
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          New project
        </h1>
        <p className="text-sm text-muted-foreground">{stepSubtitle}</p>
      </header>

      {currentStep === 1 ? (
        <>
          {!activeCompanyId || !hydrated || accessQuery.isPending ? (
            <ArchetypePickerSkeleton />
          ) : accessQuery.isError ? (
            <Card className="flex flex-col gap-4 border-destructive/40 bg-destructive/5 p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-destructive">
                  <AlertTriangle size={20} aria-hidden />
                </span>
                <div className="flex flex-col gap-1">
                  <div className="font-medium text-foreground">Could not load project options</div>
                  <p className="text-sm text-muted-foreground">
                    {accessQuery.error instanceof Error
                      ? accessQuery.error.message
                      : "Unexpected error"}
                  </p>
                </div>
              </div>
              <div>
                <Button variant="outline" onClick={() => void accessQuery.refetch()}>
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
        </>
      ) : currentStep === 2 ? (
        !hydrated || !draft.archetype ? (
          <ArchetypePickerSkeleton />
        ) : (
          <ProjectBasicsForm
            archetype={draft.archetype}
            defaultValues={draft.basics}
            onSubmit={handleBasicsSubmit}
            onBack={() => void navigate({ to: "/projects/new", search: { step: 1 } })}
          />
        )
      ) : currentStep === 3 ? (
        !hydrated || !draft.archetype || !activeCompanyId ? (
          <TemplatePickerSkeleton />
        ) : templatesQuery.isPending ? (
          <TemplatePickerSkeleton />
        ) : templatesQuery.isError ? (
          <WizardErrorPanel
            title="Could not load templates"
            message={
              templatesQuery.error instanceof Error
                ? templatesQuery.error.message
                : "Unexpected error"
            }
            onRetry={() => void templatesQuery.refetch()}
          />
        ) : (
          <ProjectSelectionForm
            templates={templatesQuery.data}
            defaultValues={draft.selection}
            onSubmit={handleSelectionSubmit}
            onBack={() => void navigate({ to: "/projects/new", search: { step: 2 } })}
          />
        )
      ) : !hydrated ||
        !activeCompanyId ||
        !draft.archetype ||
        !draft.basics ||
        !draft.selection ||
        teamQuery.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : teamQuery.isError ? (
        <WizardErrorPanel
          title="Could not load team candidates"
          message={teamQuery.error instanceof Error ? teamQuery.error.message : "Unexpected error"}
          onRetry={() => void teamQuery.refetch()}
        />
      ) : (
        <TeamForm
          projectAdmins={teamQuery.data.admins}
          members={teamQuery.data.profiles}
          deptCandidates={teamQuery.data.deptCandidates}
          defaultValues={draft.team}
          submitting={createMutation.isPending}
          onSubmit={handleTeamSubmit}
          onBack={() => void navigate({ to: "/projects/new", search: { step: 3 } })}
        />
      )}
    </div>
  );
}
