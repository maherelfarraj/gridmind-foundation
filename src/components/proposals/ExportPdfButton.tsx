// P-047 — Export proposal PDF button (uses branded client-side generator).
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  buildProposalPdf,
  downloadBlob,
} from "@/lib/exports/proposal-pdf";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  getProposalPdfData,
  recordProposalExport,
} from "@/lib/proposal.functions";

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
  companyId,
  projectId,
  size = "sm",
  variant = "outline",
  label = "Export PDF",
}: ExportPdfButtonProps) {
  const [pending, setPending] = useState(false);
  const getData = useServerFn(getProposalPdfData);
  const record = useServerFn(recordProposalExport);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      try {
        await assertExportAllowed(supabase, {
          companyId,
          projectId: projectId ?? null,
        });
      } catch (lockErr: any) {
        toast.error("Exports locked by governance");
        // Silent abort per spec.
        // eslint-disable-next-line no-console
        console.debug("export locked", lockErr?.message);
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
  return (
    <Button
      size={size}
      variant={variant}
      onClick={run}
      disabled={pending}
      aria-label={isIcon ? label : undefined}
      title={isIcon ? label : undefined}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : (
        <FileDown size={14} aria-hidden />
      )}
      {!isIcon && (pending ? "Exporting…" : label)}
    </Button>
  );
}
