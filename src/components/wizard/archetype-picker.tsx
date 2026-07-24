// P-033 — Archetype picker grid.
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PlanTier } from "@/lib/permissions";
import type { ProjectArchetype } from "@/lib/wizard-draft";
import { ARCHETYPES, type ArchetypeEntry } from "./archetype-catalog";

type Props = {
  planTier: PlanTier;
  greenHydrogenEnabled: boolean;
  value: ProjectArchetype | undefined;
  onChange: (next: ProjectArchetype) => void;
};

function isDisabled(
  entry: ArchetypeEntry,
  planTier: PlanTier,
  greenHydrogenEnabled: boolean,
): boolean {
  if (entry.key === "green_hydrogen") {
    return planTier !== "enterprise" || !greenHydrogenEnabled;
  }
  return false;
}

export function ArchetypePicker({
  planTier,
  greenHydrogenEnabled,
  value,
  onChange,
}: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Project archetype"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {ARCHETYPES.map((entry) => {
        const disabled = isDisabled(entry, planTier, greenHydrogenEnabled);
        const selected = value === entry.key;
        const Icon = entry.icon;
        return (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(entry.key);
            }}
            className={cn(
              "text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl",
              disabled && "cursor-not-allowed",
            )}
          >
            <Card
              className={cn(
                "flex h-full flex-col gap-3 border-border bg-card p-5",
                selected && "ring-2 ring-primary border-primary/40",
                disabled && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
                    <Icon size={20} aria-hidden />
                  </span>
                  <div>
                    <div className="font-display text-base font-semibold text-foreground">
                      {entry.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.capacityHint}
                    </div>
                  </div>
                </div>
                {disabled ? (
                  <a
                    href="/settings/billing"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    <Badge variant="outline" className="border-border">
                      Enterprise plan required
                    </Badge>
                  </a>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {entry.description}
              </p>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

export function ArchetypePickerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {ARCHETYPES.map((entry) => (
        <Skeleton key={entry.key} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}
