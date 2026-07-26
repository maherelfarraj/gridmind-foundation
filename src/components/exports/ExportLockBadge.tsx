// P-113 — Visual indicator for active export locks on a project header.
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveExportLocks } from "@/lib/export-locks.hooks";

const LABELS: Record<string, string> = {
  proposal_pdf: "Proposal PDF",
  proposal_pptx: "Proposal PPTX",
  weekly_client_report: "Weekly report",
  om_report: "O&M report",
  turnover_pack: "Turnover pack",
  audit_pack: "Audit pack",
  csv: "CSV",
  sld_schedule: "SLD schedule",
};

interface ExportLockBadgeProps {
  projectId: string | null | undefined;
  className?: string;
}

export function ExportLockBadge({ projectId, className }: ExportLockBadgeProps) {
  const { data } = useActiveExportLocks(projectId);
  if (!data || data.length === 0) return null;
  const labels = Array.from(new Set(data.map((l) => LABELS[l.export_type] ?? l.export_type)));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-accent px-2 py-1 text-xs font-medium text-accent-foreground",
        className,
      )}
      title={`Exports locked: ${labels.join(", ")}`}
    >
      <Lock size={12} aria-hidden />
      <span>Exports locked: {labels.join(", ")}</span>
    </span>
  );
}
