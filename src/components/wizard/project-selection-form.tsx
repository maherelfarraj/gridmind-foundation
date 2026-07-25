// P-035 — Wizard step 3 form: template + gates + budget + departments.
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BudgetLinesEditor } from "./budget-lines-editor";
import { DepartmentsPicker } from "./departments-picker";
import { GatesEditor } from "./gates-editor";
import { TemplatePicker } from "./template-picker";
import type { TemplateOption } from "@/lib/projects.functions";
import {
  BLANK_SELECTION,
  projectSelectionSchema,
  type ProjectSelection,
} from "@/lib/schemas/project-wizard";

type Props = {
  templates: TemplateOption[];
  defaultValues?: ProjectSelection;
  onSubmit: (values: ProjectSelection) => void;
  onBack: () => void;
};

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ProjectSelectionForm({ templates, defaultValues, onSubmit, onBack }: Props) {
  const initial: ProjectSelection =
    defaultValues ??
    (templates[0]
      ? {
          template_id: templates[0].id,
          gates: templates[0].gates,
          budget_lines: templates[0].budgetLines,
          departments: templates[0].departments,
        }
      : BLANK_SELECTION);

  const form = useForm<ProjectSelection>({
    resolver: zodResolver(projectSelectionSchema),
    mode: "onChange",
    defaultValues: initial,
  });

  const userEditedSinceLoad = useRef(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null | undefined>(undefined);

  const applyTemplate = (id: string | null) => {
    if (id === null) {
      form.reset(BLANK_SELECTION);
    } else {
      const t = templates.find((x) => x.id === id);
      if (!t) return;
      form.reset({
        template_id: t.id,
        gates: t.gates,
        budget_lines: t.budgetLines,
        departments: t.departments,
      });
    }
    userEditedSinceLoad.current = false;
  };

  const handleTemplateChange = (id: string | null) => {
    if (userEditedSinceLoad.current) {
      setPendingTemplateId(id);
      return;
    }
    applyTemplate(id);
  };

  const markEdited = () => {
    userEditedSinceLoad.current = true;
  };

  const errors = form.formState.errors;
  const budgetError = errors.budget_lines?.message ?? errors.budget_lines?.root?.message;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <SectionHeader
          title="Template"
          hint="Pick a starting point. You can adjust everything below."
        />
        <Controller
          control={form.control}
          name="template_id"
          render={({ field }) => (
            <TemplatePicker
              templates={templates}
              value={field.value}
              onChange={handleTemplateChange}
            />
          )}
        />
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <SectionHeader
          title="Phase gates"
          hint="The approval checkpoints that gate progress between phases."
        />
        <Controller
          control={form.control}
          name="gates"
          render={({ field }) => (
            <GatesEditor
              value={field.value}
              onChange={(next) => {
                markEdited();
                field.onChange(next);
              }}
            />
          )}
        />
        {errors.gates?.message ? (
          <p className="text-sm text-destructive">{errors.gates.message}</p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <SectionHeader
          title="Budget lines"
          hint="Cost categories as shares of the total budget. Must sum to 100%."
        />
        <Controller
          control={form.control}
          name="budget_lines"
          render={({ field }) => (
            <BudgetLinesEditor
              value={field.value}
              onChange={(next) => {
                markEdited();
                field.onChange(next);
              }}
            />
          )}
        />
        {budgetError ? <p className="text-sm text-destructive">{budgetError}</p> : null}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <SectionHeader title="Departments" hint="Which teams take part in this project." />
        <Controller
          control={form.control}
          name="departments"
          render={({ field }) => (
            <DepartmentsPicker
              value={field.value}
              onChange={(next) => {
                markEdited();
                field.onChange(next);
              }}
            />
          )}
        />
        {errors.departments?.message ? (
          <p className="text-sm text-destructive">{errors.departments.message}</p>
        ) : null}
      </Card>

      <footer className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!form.formState.isValid}>
          Next
        </Button>
      </footer>

      <AlertDialog
        open={pendingTemplateId !== undefined}
        onOpenChange={(o) => !o && setPendingTemplateId(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              Loading this template will overwrite the gates, budget lines, and departments
              you&apos;ve edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingTemplateId(undefined)}>
              Keep my edits
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTemplateId !== undefined) {
                  applyTemplate(pendingTemplateId);
                }
                setPendingTemplateId(undefined);
              }}
            >
              Load template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
