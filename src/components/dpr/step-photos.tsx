// P-086 — Photos & observations step: capture/gallery + quick-add observation.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { dprDetailQueryOptions, errorMessage } from "@/lib/dpr-query";
import {
  attachPhoto,
  createObservation,
  removePhoto,
  signPhotoUrls,
  type DprRow,
  type ObservationRow,
  type SitePhotoRow,
} from "@/lib/dpr.functions";
import {
  OBSERVATION_SEVERITIES,
  photoObjectPath,
  type ObservationSeverity,
} from "@/lib/dpr.rules";

interface Props {
  header: DprRow;
  photos: SitePhotoRow[];
  observations: ObservationRow[];
  readOnly: boolean;
}

const SEV_LABEL: Record<ObservationSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function StepPhotos({ header, photos, observations, readOnly }: Props) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: dprDetailQueryOptions(header.id).queryKey,
    });
  const attach = useServerFn(attachPhoto);
  const remove = useServerFn(removePhoto);
  const sign = useServerFn(signPhotoUrls);
  const createObs = useServerFn(createObservation);

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const paths = photos.map((p) => p.file_path);
  const signedQuery = useQuery({
    queryKey: ["dpr", "photo-urls", header.id, paths.join("|")],
    queryFn: () => sign({ data: { paths } }),
    enabled: paths.length > 0,
    staleTime: 5 * 60_000,
  });

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = photoObjectPath(
          header.company_id,
          header.project_id,
          header.report_date,
          file.name,
        );
        const { error } = await supabase.storage
          .from("photos")
          .upload(path, file, { contentType: file.type || "image/jpeg" });
        if (error) throw error;
        await attach({
          data: {
            dprId: header.id,
            observationId: null,
            projectId: header.project_id,
            filePath: path,
            caption: null,
            area: null,
            discipline: null,
          },
        });
      }
      toast.success("Photos uploaded");
      invalidate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id, dprId: header.id } }),
    onSuccess: () => {
      toast.success("Photo removed");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // observation sheet
  const [obsOpen, setObsOpen] = useState(false);
  const [obsPhotoId, setObsPhotoId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<ObservationSeverity>("low");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [dueDate, setDueDate] = useState("");

  const obsMut = useMutation({
    mutationFn: async () => {
      const obs = await createObs({
        data: {
          dprId: header.id,
          projectId: header.project_id,
          severity,
          description,
          area: area.trim() || null,
          discipline: "general",
          dueDate: dueDate || null,
        },
      });
      // link the selected photo (if any) to the observation
      if (obsPhotoId) {
        const p = photos.find((x) => x.id === obsPhotoId);
        if (p) {
          // re-insert relation by attaching a new row is heavy; use REST update instead
          await supabase
            .from("site_photos")
            .update({ observation_id: obs.id } as any)
            .eq("id", p.id);
        }
      }
      return obs;
    },
    onSuccess: () => {
      toast.success("Observation added");
      setObsOpen(false);
      setSeverity("low");
      setDescription("");
      setArea("");
      setDueDate("");
      setObsPhotoId(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4" aria-hidden /> Site photos
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {photos.length === 0 && (
            <div className="rounded-md border border-warning-foreground/30 bg-warning/15 p-3 text-sm text-warning-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <div>
                  No photos attached — site photos <b>SHOULD</b> accompany every
                  DPR.
                </div>
              </div>
            </div>
          )}
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((p) => {
                const url = signedQuery.data?.[p.file_path];
                return (
                  <li
                    key={p.id}
                    className="group relative overflow-hidden rounded-md border border-border bg-muted"
                  >
                    <div className="aspect-square w-full bg-muted">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={p.caption ?? "Site photo"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        </div>
                      )}
                    </div>
                    {p.observation_id && (
                      <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                        Obs
                      </span>
                    )}
                    {!readOnly && (
                      <div className="absolute inset-x-1 bottom-1 flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 flex-1 text-xs"
                          onClick={() => {
                            setObsPhotoId(p.id);
                            setObsOpen(true);
                          }}
                        >
                          Link obs
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          className="h-8 w-8"
                          onClick={() => delMut.mutate(p.id)}
                          aria-label="Delete photo"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!readOnly && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                className="h-11"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" aria-hidden />
                )}
                Add photos
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={readOnly}
                onClick={() => {
                  setObsPhotoId(null);
                  setObsOpen(true);
                }}
              >
                <AlertTriangle className="mr-2 h-4 w-4" aria-hidden />
                Quick observation
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Observations on this DPR</CardTitle>
        </CardHeader>
        <CardContent>
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">None logged.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {observations.map((o) => (
                <li
                  key={o.id}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {o.description}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs uppercase text-muted-foreground">
                      {o.severity}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {o.area ?? "—"}
                    {o.due_date ? ` · due ${o.due_date}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet open={obsOpen} onOpenChange={setObsOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Quick observation</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="obs-desc">Description</Label>
              <Textarea
                id="obs-desc"
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Severity</Label>
                <Select
                  value={severity}
                  onValueChange={(v) => setSeverity(v as ObservationSeverity)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBSERVATION_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEV_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="obs-due">Due date</Label>
                <Input
                  id="obs-due"
                  type="date"
                  className="h-11"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="obs-area">Area</Label>
              <Input
                id="obs-area"
                className="h-11"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </div>
            {obsPhotoId && (
              <p className="text-xs text-muted-foreground">
                Linking selected photo to this observation.
              </p>
            )}
            <Button
              type="button"
              className="h-11"
              disabled={obsMut.isPending || description.trim().length === 0}
              onClick={() => obsMut.mutate()}
            >
              Save observation
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// avoid unused import warning in some tsconfigs
useEffect;
