// P-222 — Shared vendor portal state cards.
import type { LucideIcon } from "lucide-react";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export function VendorStateCard({
  icon: Icon = ShieldAlert,
  title,
  description,
  onRetry,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function VendorTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md border border-border bg-card" />
      ))}
    </div>
  );
}
