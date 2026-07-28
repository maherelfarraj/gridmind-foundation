// P-054 — SLD gallery grid + New SLD dialog.
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Lock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import { listSldDrawings } from "@/lib/sld.functions";
import { sldDrawingsQueryOptions, useCreateSldDrawing } from "@/lib/sld-query";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline",
  IFD: "secondary",
  IFC: "default",
  as_built: "secondary",
  superseded: "outline",
};

export function SldGallery({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const { t } = useI18n();
  const listFn = useServerFn(listSldDrawings);
  const { data: rows } = useSuspenseQuery(sldDrawingsQueryOptions(listFn, projectId));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("engMod.sld.gallery.title")}</h2>
        {canWrite && <NewSldDialog projectId={projectId} />}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={FileText}
              title={t("engMod.sld.gallery.empty.title")}
              description={t("engMod.sld.gallery.empty.description")}
              action={canWrite ? <NewSldDialog projectId={projectId} /> : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link
              key={row.id}
              to="/projects/$projectId/engineering/drawings/$drawingId"
              params={{ projectId, drawingId: row.id }}
              className="block"
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-mono">{row.drawing_number}</CardTitle>
                    {row.locked && <Lock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{row.title}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                    <FileText className="h-8 w-8" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={STATUS_VARIANTS[row.current_status] ?? "outline"}
                      className={
                        row.current_status === "superseded" ? "line-through opacity-70" : ""
                      }
                    >
                      {row.current_status}
                    </Badge>
                    {row.revision_code && <Badge variant="outline">{t("engMod.sld.gallery.revision", { code: row.revision_code })}</Badge>}
                    {row.markup_count > 0 && (
                      <Badge variant="secondary">
                        {t("engMod.sld.gallery.markup", { count: row.markup_count })}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const dialogSchema = z.object({
  drawingNumber: z.string().trim().min(1, "Required").max(80),
  title: z.string().trim().min(1, "Required").max(200),
});

type DialogValues = z.infer<typeof dialogSchema>;

function NewSldDialog({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const create = useCreateSldDrawing(projectId);
  const form = useForm<DialogValues>({
    resolver: zodResolver(dialogSchema),
    defaultValues: { drawingNumber: "", title: "" },
  });

  const onSubmit = form.handleSubmit((v) => {
    create.mutate(v, {
      onSuccess: () => {
        setOpen(false);
        form.reset({ drawingNumber: "", title: "" });
      },
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          {t("engMod.sld.gallery.newSld.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("engMod.sld.gallery.newSld.title")}</DialogTitle>
          <DialogDescription>
            {t("engMod.sld.gallery.newSld.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="drawingNumber">{t("engMod.sld.gallery.newSld.numberLabel")}</Label>
            <Input
              id="drawingNumber"
              placeholder="e.g. 001 or SLD-001"
              {...form.register("drawingNumber")}
            />
            {form.formState.errors.drawingNumber && (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.drawingNumber.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="title">{t("engMod.sld.gallery.newSld.titleLabel")}</Label>
            <Input
              id="title"
              placeholder="Overall single-line diagram"
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <p className="mt-1 text-xs text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("engMod.common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("engMod.common.creating") : t("engMod.sld.gallery.newSld.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
