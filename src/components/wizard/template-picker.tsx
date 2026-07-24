// P-035 — Template picker for wizard step 3.
import { LayoutTemplate, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TemplateOption } from "@/lib/projects.functions";

type Props = {
  templates: TemplateOption[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
};

export function TemplatePicker({ templates, value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Project template"
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      {templates.map((t) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(t.id)}
            className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
          >
            <Card
              className={cn(
                "flex h-full flex-col gap-3 border-border bg-card p-5",
                selected && "ring-2 ring-primary border-primary/40",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
                    <LayoutTemplate size={20} aria-hidden />
                  </span>
                  <div>
                    <div className="font-display text-base font-semibold text-foreground">
                      {t.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.gates.length} gates · {t.budgetLines.length} budget
                      lines · {t.departments.length} depts
                    </div>
                  </div>
                </div>
                {t.isSystem ? (
                  <Badge variant="outline" className="border-border">
                    System
                  </Badge>
                ) : null}
              </div>
              {t.description ? (
                <p className="text-sm text-muted-foreground">{t.description}</p>
              ) : null}
            </Card>
          </button>
        );
      })}

      {/* Start blank */}
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        onClick={() => onChange(null)}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
      >
        <Card
          className={cn(
            "flex h-full flex-col gap-3 border-dashed border-border bg-card p-5",
            value === null && "ring-2 ring-primary border-primary/40",
          )}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
              <Sparkles size={20} aria-hidden />
            </span>
            <div>
              <div className="font-display text-base font-semibold text-foreground">
                Start blank
              </div>
              <div className="text-xs text-muted-foreground">
                Build your own gates, budget, and teams from scratch.
              </div>
            </div>
          </div>
        </Card>
      </button>
    </div>
  );
}

export function TemplatePickerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}
