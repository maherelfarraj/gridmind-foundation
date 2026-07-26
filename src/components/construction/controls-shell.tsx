// P-180 — Shared shell bits for the planning & controls surfaces.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ProjectOptionRow {
  id: string;
  name: string;
  code: string;
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  loading,
}: {
  projects: ProjectOptionRow[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-9 w-full sm:w-64" />;
  return (
    <div className="w-full space-y-1 sm:w-64">
      <Label htmlFor="controls-project" className="text-xs text-muted-foreground">
        Project
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="controls-project">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.code} — {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Uniform skeleton / error-with-retry / empty handling for a panel. Returns
 * null when the panel should render its own children.
 */
export function PanelState({
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  skeletonRows = 4,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyIcon?: LucideIcon;
  emptyAction?: ReactNode;
  skeletonRows?: number;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load this panel"
        description="The request failed. Check your connection and try again."
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (isEmpty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle ?? "Nothing here yet"}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }
  return <>{children}</>;
}
