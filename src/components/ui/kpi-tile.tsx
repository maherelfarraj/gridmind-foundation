// POL-1 — Shared KPI tile: icon chip, large value, muted label, optional delta chip + status ring.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type KpiStatus = "neutral" | "good" | "warning" | "bad";

const STATUS_RING: Record<KpiStatus, string> = {
  neutral: "",
  good: "ring-1 ring-inset ring-accent/40",
  warning: "ring-1 ring-inset ring-warning/50",
  bad: "ring-1 ring-inset ring-destructive/50",
};

const STATUS_VALUE: Record<KpiStatus, string> = {
  neutral: "text-foreground",
  good: "text-accent",
  warning: "text-warning",
  bad: "text-destructive",
};

const DELTA_TONE: Record<KpiStatus, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-accent/10 text-accent",
  warning: "bg-warning/15 text-warning",
  bad: "bg-destructive/10 text-destructive",
};

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Small chip rendered next to the value, e.g. "+4.2%". */
  delta?: ReactNode;
  /** Tints the value, delta chip and adds a subtle status ring. */
  status?: KpiStatus;
  isLoading?: boolean;
  className?: string;
}

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  status = "neutral",
  isLoading = false,
  className,
}: KpiTileProps) {
  return (
    <Card
      className={cn("flex flex-col gap-3 p-4 transition-colors", STATUS_RING[status], className)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        {isLoading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={cn("truncate text-2xl font-semibold tracking-tight", STATUS_VALUE[status])}
            >
              {value}
            </span>
            {delta ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  DELTA_TONE[status === "neutral" ? "neutral" : status],
                )}
              >
                {delta}
              </span>
            ) : null}
          </div>
        )}
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </Card>
  );
}

/** Standard KPI grid rhythm: grid gap-4 sm:grid-cols-2 lg:grid-cols-4. */
export function KpiGrid({
  children,
  className,
  columns = 4,
  label = "Key performance indicators",
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 6;
  label?: string;
}) {
  const cols =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : columns === 6
          ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <section aria-label={label} className={cn("grid gap-4", cols, className)}>
      {children}
    </section>
  );
}
