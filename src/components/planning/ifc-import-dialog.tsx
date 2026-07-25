// P-072 — Import IFC packages into the WBS.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

import { importIfcPackages, proposeIfcPackages } from "@/lib/wbs.functions";
import { wbsErrorMessage, wbsIfcProposalsQueryOptions } from "@/lib/wbs-query";
import { WBS_DISCIPLINE_LABEL, type WbsDiscipline } from "@/lib/wbs-rules";

interface IfcImportDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function IfcImportDialog({
  projectId,
  open,
  onOpenChange,
  onImported,
}: IfcImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import IFC packages</DialogTitle>
          <DialogDescription>
            Released Issued-for-Construction packages become WBS nodes under an
            &ldquo;Engineering&rdquo; root. Already-imported packages are skipped.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <IfcProposalsBody
            projectId={projectId}
            onClose={() => onOpenChange(false)}
            onImported={onImported}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IfcProposalsBody({
  projectId,
  onClose,
  onImported,
}: {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const proposeFn = useServerFn(proposeIfcPackages);
  const importFn = useServerFn(importIfcPackages);

  const query = useSuspenseQuery(wbsIfcProposalsQueryOptions(proposeFn, projectId));
  const { proposals } = query.data;

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // Pre-select proposals that aren't already imported.
    setSelected(
      new Set(proposals.filter((p) => !p.already_imported).map((p) => p.ifc_package_ref)),
    );
  }, [proposals]);

  const importable = useMemo(() => proposals.filter((p) => !p.already_imported), [proposals]);

  const importMut = useMutation({
    mutationFn: (packages: typeof proposals) =>
      importFn({
        data: {
          projectId,
          packages: packages.map((p) => ({
            code: p.code,
            name: p.name,
            discipline: p.discipline as WbsDiscipline | null,
            ifc_package_ref: p.ifc_package_ref,
          })),
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.imported === 0
          ? "Nothing to import — all packages already in WBS."
          : `Imported ${res.imported} package${res.imported === 1 ? "" : "s"}`,
      );
      onImported();
      onClose();
    },
    onError: (e) => toast.error(wbsErrorMessage(e)),
  });

  const toggle = (ref: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const chosen = importable.filter((p) => selected.has(p.ifc_package_ref));

  return (
    <>
      <ScrollArea className="max-h-[420px]">
        {proposals.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            No released IFC packages found for this project. Publish an IFC release first to enable
            import.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {proposals.map((p) => {
              const disabled = p.already_imported;
              const checked = selected.has(p.ifc_package_ref);
              return (
                <li
                  key={p.ifc_package_ref}
                  className="flex items-start gap-3 rounded border border-border bg-card/40 p-3"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => !disabled && toggle(p.ifc_package_ref)}
                    disabled={disabled}
                    aria-label={`Select ${p.name}`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      {p.discipline && (
                        <Badge variant="secondary" className="text-xs">
                          {WBS_DISCIPLINE_LABEL[p.discipline as WbsDiscipline]}
                        </Badge>
                      )}
                      {p.already_imported && (
                        <Badge variant="outline" className="text-xs">
                          Already imported
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {p.drawing_count} drawing
                      {p.drawing_count === 1 ? "" : "s"} · Released{" "}
                      {p.released_at ? format(new Date(p.released_at), "dd MMM yyyy") : "—"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={importMut.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => importMut.mutate(chosen)}
          disabled={chosen.length === 0 || importMut.isPending}
        >
          Import {chosen.length > 0 ? `(${chosen.length})` : ""}
        </Button>
      </DialogFooter>
    </>
  );
}
