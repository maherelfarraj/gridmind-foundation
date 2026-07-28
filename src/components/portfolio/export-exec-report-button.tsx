// P-255 — "Export executive report" trigger.
// The document itself is always English (P-244 export doctrine); only this
// button's chrome follows the UI locale.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/locale-provider";
import { downloadBlob } from "@/lib/exports/theme";
import { buildPortfolioExecReportPdf } from "@/lib/exports/portfolio-exec-pdf";
import { getPortfolioExecReportData } from "@/lib/portfolio.functions";

export function ExportExecReportButton() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const fetchData = useServerFn(getPortfolioExecReportData);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const data = await fetchData({ data: { back: 12, forward: 6 } });
      const { bytes, filename } = await buildPortfolioExecReportPdf(data);
      downloadBlob(filename, new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setLocked(false);
      toast.success(t("portfolioMod.export.success"));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e?.statusCode === 423 || e?.code === "export_locked") {
        setLocked(true);
        toast.error(t("portfolioMod.export.locked"));
      } else if (e?.statusCode === 403 || e?.message === "forbidden_role") {
        toast.error(t("portfolioMod.export.forbidden"));
      } else {
        toast.error(e?.message ?? t("portfolioMod.export.failed"));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={pending}>
      {pending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : locked ? (
        <Lock size={14} aria-hidden />
      ) : (
        <FileDown size={14} aria-hidden />
      )}
      {pending ? t("portfolioMod.export.pending") : t("portfolioMod.export.action")}
    </Button>
  );
}
