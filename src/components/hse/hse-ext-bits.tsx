// P-185 — Shared presentation bits for the HSE expansion registers.
import type { LucideIcon } from "lucide-react";
import { Download } from "lucide-react";
import type { ReactNode } from "react";

import {
  PanelState,
  ProjectSelect,
  type ProjectOptionRow,
} from "@/components/construction/controls-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableSearch, DataTableToolbar } from "@/components/ui/data-table";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  daysUntil,
  expiryState,
  residualScore,
  riskBand,
  riskBandClass,
  type Hazard,
} from "@/lib/hse-ext.rules";
import { cn } from "@/lib/utils";

export function RiskBadge({ score, label }: { score: number; label?: string }) {
  const band = riskBand(score);
  return (
    <Badge variant="outline" className={cn("tabular-nums", riskBandClass(band))}>
      {label ?? score} · {band}
    </Badge>
  );
}

export function HazardResidualBadge({ hazard }: { hazard: Hazard }) {
  return <RiskBadge score={residualScore(hazard)} />;
}

export function ExpiryBadge({ expiry }: { expiry: string | null | undefined }) {
  const state = expiryState(expiry);
  const days = daysUntil(expiry);
  if (state === "none") return <span className="text-muted-foreground">—</span>;
  const cls =
    state === "expired"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : state === "expiring"
        ? "bg-warning/15 text-warning-foreground border-warning/30"
        : "bg-success/15 text-success border-success/30";
  const text = state === "expired" ? `Expired ${Math.abs(days ?? 0)}d ago` : `${days}d`;
  return (
    <Badge variant="outline" className={cn("tabular-nums", cls)}>
      {text}
    </Badge>
  );
}

export function CsvButton({
  filename,
  headers,
  rows,
  disabled,
}: {
  filename: string;
  headers: string[];
  rows: (readonly unknown[])[];
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || rows.length === 0}
      onClick={() => downloadCsv(filename, toCsv(headers, rows))}
    >
      <Download size={14} aria-hidden /> Export CSV
    </Button>
  );
}

/** Register shell: project filter + search + actions, then a state-aware panel. */
export function HseRegister({
  title,
  icon,
  projects,
  projectId,
  onProjectChange,
  search,
  onSearchChange,
  actions,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  projects: ProjectOptionRow[];
  projectId: string;
  onProjectChange: (v: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  actions?: ReactNode;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTableToolbar
          search={<DataTableSearch value={search} onChange={onSearchChange} placeholder="Search" />}
          filters={
            <div className="w-full sm:w-64">
              <ProjectSelect projects={projects} value={projectId} onChange={onProjectChange} />
            </div>
          }
          actions={actions}
        />
        <PanelState
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
          isEmpty={isEmpty}
          emptyIcon={icon}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        >
          {children}
        </PanelState>
      </CardContent>
    </Card>
  );
}
