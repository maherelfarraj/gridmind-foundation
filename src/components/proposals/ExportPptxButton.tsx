// P-048 — Export proposal PPTX button (branded, native chart).
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Presentation, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  buildProposalPptx,
  downloadBlob,
} from "@/lib/exports/proposal-pptx";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  getProposalExportData,
  recordProposalExport,
} from "@/lib/proposal.functions";

interface ExportPptxButtonProps {
  proposalId: string;
  companyId: string;
  projectId?: string | null;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary";
  label?: string;
}

export function ExportPptxButton({
  proposalId,
  companyId,
  projectId,
  size = "sm",
  variant = "outline",
  label = "Export PPTX",
}: ExportPptxButtonProps) {
  const [pending, setPending] = useState(false);
  const getData = useServerFn(getProposalExportData);
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
        // eslint-disable-next-line no-console
        console.debug("export locked", lockErr?.message);
        return;
      }

      const data = await getData({ data: { proposalId } });
      const { blob, filename } = await buildProposalPptx(data as any);
      downloadBlob(filename, blob);
      await record({ data: { proposalId, format: "pptx" } });
      toast.success("Proposal PPTX exported");
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
        <Presentation size={14} aria-hidden />
      )}
      {!isIcon && (pending ? "Exporting…" : label)}
    </Button>
  );
}
