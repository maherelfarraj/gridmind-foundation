import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { signInspectionAttachment } from "@/lib/qaqc.functions";
import { errorMessage } from "@/lib/qaqc-query";
import type { QaqcAttachment } from "@/lib/qaqc.rules";

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: QaqcAttachment[];
  onRemove?: (index: number) => void;
}) {
  const [openingIdx, setOpeningIdx] = useState<number | null>(null);
  const open = async (path: string, idx: number) => {
    try {
      setOpeningIdx(idx);
      const { url } = await signInspectionAttachment({
        data: { path } as any,
      });
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Could not open attachment");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOpeningIdx(null);
    }
  };
  if (attachments.length === 0) {
    return <EmptyState icon={FileText} title="No attachments" compact />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {attachments.map((a, i) => (
        <li
          key={`${a.file_path}-${i}`}
          className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
        >
          <FileText size={16} className="text-muted-foreground" aria-hidden />
          <div className="flex-1 truncate text-sm text-foreground">
            {a.label || a.file_path.split("/").pop()}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => open(a.file_path, i)}
            disabled={openingIdx === i}
          >
            {openingIdx === i ? <Loader2 size={14} className="animate-spin" aria-hidden /> : "Open"}
          </Button>
          {onRemove ? (
            <Button variant="ghost" size="sm" onClick={() => onRemove(i)} aria-label="Remove">
              Remove
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
