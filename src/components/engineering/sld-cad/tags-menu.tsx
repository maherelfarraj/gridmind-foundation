// P-141 — Tags menu: retag preview diff, auto-resolve duplicates, objects list.
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Tags, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApplyRetag, useRetagPreview } from "@/lib/sld-tagging-query";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { autoResolveDuplicates, findDuplicateTags } from "@/lib/sld/tagging";
import type { SymbolTypeRecord } from "@/lib/sld/symbol-registry";

export function TagsMenu({
  drawingId,
  editable,
  symbols,
}: {
  drawingId: string;
  editable: boolean;
  symbols: SymbolTypeRecord[];
}) {
  const objects = useCanvasStore((s) => s.objects);
  const areas = useCanvasStore((s) => s.areas);
  const applyTagPlan = useCanvasStore((s) => s.applyTagPlan);
  const [force, setForce] = useState(false);
  const [open, setOpen] = useState(false);

  const preview = useRetagPreview(drawingId);
  const apply = useApplyRetag(drawingId);

  const duplicates = useMemo(() => findDuplicateTags(objects), [objects]);
  const prefixes = useMemo(
    () => symbols.map((s) => ({ type_key: s.type_key, tag_prefix: s.tag_prefix })),
    [symbols],
  );

  const runPreview = (withForce: boolean) => {
    setForce(withForce);
    setOpen(true);
    preview.mutate({ force: withForce });
  };

  const autoResolve = () => {
    const fixes = autoResolveDuplicates(objects, prefixes, areas);
    if (fixes.length === 0) {
      return;
    }
    applyTagPlan(fixes.map((f) => ({ id: f.id, tag: f.tag })));
  };

  const plan = preview.data;
  const changeCount = (plan?.tags.length ?? 0) + (plan?.cables.length ?? 0);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Tags className="size-4" />
            Tags
            {duplicates.length > 0 ? (
              <Badge variant="destructive" className="ml-1">
                {duplicates.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Tagging</DropdownMenuLabel>
          <DropdownMenuItem disabled={!editable} onSelect={() => runPreview(false)}>
            Retag drawing (keep existing)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!editable} onSelect={() => runPreview(true)}>
            Retag drawing — force renumber
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!editable || duplicates.length === 0}
            onSelect={() => autoResolve()}
          >
            <Wand2 className="mr-2 size-4" />
            Auto-resolve {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Retag preview{force ? " — force renumber" : ""}</DialogTitle>
            <DialogDescription>
              {preview.isPending
                ? "Computing tag plan…"
                : changeCount === 0
                  ? "Every tag already matches the deterministic plan — nothing to change."
                  : `${plan?.tags.length ?? 0} equipment tags and ${plan?.cables.length ?? 0} cable numbers will change.`}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-4 text-sm">
              {plan?.tags.length ? (
                <div className="space-y-1">
                  <p className="font-medium">Equipment tags</p>
                  {plan.tags.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-muted-foreground">{t.previous ?? "untagged"}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span>{t.tag}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {plan?.cables.length ? (
                <div className="space-y-1">
                  <p className="font-medium">Cable numbers</p>
                  {plan.cables.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-muted-foreground">{c.previous ?? "unnumbered"}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span>{c.cable_number}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!editable || changeCount === 0 || apply.isPending}
              onClick={async () => {
                await apply.mutateAsync({ force });
                setOpen(false);
              }}
            >
              Apply {changeCount} change{changeCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DuplicateTagWarning() {
  const objects = useCanvasStore((s) => s.objects);
  const duplicates = useMemo(() => findDuplicateTags(objects), [objects]);
  if (duplicates.length === 0) return null;
  return (
    <span className="flex items-center gap-1 text-destructive">
      <AlertTriangle className="size-3.5" />
      {duplicates.length} duplicate tag{duplicates.length === 1 ? "" : "s"}
    </span>
  );
}
