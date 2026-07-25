// P-047 / P-113 — Export proposal PDF button with live lock state.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { buildProposalPdf, downloadBlob } from "@/lib/exports/proposal-pdf";
import { assertExportAllowed } from "@/lib/export-guard";
import { useIsExportLocked } from "@/lib/export-locks.hooks";
import { getProposalPdfData, recordProposalExport } from "@/lib/proposal.functions";

interface ExportPdfButtonProps {
  proposalId: string;
  companyId: string;
  projectId?: string | null;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary";
  label?: string;
}

export function ExportPdfButton({
  proposalId,
  projectId,
  size = "sm",
  variant = "outline",
  label = "Export PDF",
}: ExportPdfButtonProps) {
  const [pending, setPending] = useState(false);
  const getData = useServerFn(getProposalPdfData);
  const record = useServerFn(recordProposalExport);
  const lockQuery = useIsExportLocked(projectId ?? null, "proposal_pdf");
  const locked = lockQuery.data === true;

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      try {
        await assertExportAllowed(supabase, projectId ?? null, "proposal_pdf");
      } catch (lockErr: any) {
        toast.error(lockErr?.message ?? "Export blocked: approval pending");
        return;
      }

      const data = await getData({ data: { proposalId } });
      const { blob, filename } = await buildProposalPdf(data as any);
      downloadBlob(filename, blob);
      await record({ data: { proposalId } });
      toast.success("Proposal PDF exported");
    } catch (err: any) {
      toast.error(err?.message ?? "Export failed");
    } finally {
      setPending(false);
    }
  }

  const isIcon = size === "icon";
  const disabled = pending || locked;
  const btn = (
    <Button
      size={size}
      variant={variant}
      onClick={run}
      disabled={disabled}
      aria-label={isIcon ? label : undefined}
      title={isIcon && !locked ? label : undefined}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : locked ? (
        <Lock size={14} aria-hidden />
      ) : (
        <FileDown size={14} aria-hidden />
      )}
      {!isIcon && (pending ? "Exporting…" : locked ? "Export locked" : label)}
    </Button>
  );

  if (!locked) return btn;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{btn}</span>
        </TooltipTrigger>
        <TooltipContent>Export blocked while approvals are pending</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
