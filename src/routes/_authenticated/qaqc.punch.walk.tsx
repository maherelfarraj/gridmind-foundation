// P-090 — Punch walk: mobile-first rapid add loop with camera capture.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronLeft, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  errorMessage,
  punchWalkContextQueryOptions,
  qaqcProjectsQueryOptions,
} from "@/lib/qaqc-query";
import { createPunchItem, registerPunchPhoto, signPunchPhotoUpload } from "@/lib/qaqc.functions";
import {
  PUNCH_CATEGORIES,
  PUNCH_CATEGORY_DESCRIPTIONS,
  PUNCH_CATEGORY_LABELS,
  QAQC_DISCIPLINES,
  QAQC_DISCIPLINE_LABELS,
  punchCategoryTint,
  punchInput,
  type PunchCategory,
  type QaqcDiscipline,
} from "@/lib/qaqc.rules";

export const Route = createFileRoute("/_authenticated/qaqc/punch/walk")({
  head: () => ({
    meta: [
      { title: "Punch walk — GridMind EPC" },
      {
        name: "description",
        content: "Rapidly capture punch items with photos while walking the site.",
      },
      { property: "og:title", content: "Punch walk — GridMind EPC" },
      {
        property: "og:description",
        content: "One-handed capture: photo, area, discipline, category, done.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PunchWalkPage,
});

type Draft = {
  projectId: string;
  walkDate: string;
  area: string;
  discipline: QaqcDiscipline;
  category: PunchCategory;
  description: string;
  dueDate: string;
  assignedTo: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function makeDraft(overrides?: Partial<Draft>): Draft {
  return {
    projectId: "",
    walkDate: today(),
    area: "",
    discipline: "civil",
    category: "B",
    description: "",
    dueDate: "",
    assignedTo: "",
    ...overrides,
  };
}

function PunchWalkPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projectsQuery = useQuery(qaqcProjectsQueryOptions());
  const [draft, setDraft] = useState<Draft>(() => makeDraft());
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [added, setAdded] = useState<{ number: string; description: string }[]>([]);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  const walkCtxQuery = useQuery(punchWalkContextQueryOptions(draft.projectId || null));

  const canSubmit = useMemo(() => {
    const p = punchInput.safeParse({
      projectId: draft.projectId || undefined,
      walkDate: draft.walkDate,
      area: draft.area.trim(),
      discipline: draft.discipline,
      category: draft.category,
      description: draft.description.trim(),
      dueDate: draft.dueDate || null,
      assignedTo: draft.assignedTo || null,
      photoIds,
    });
    return p.success && draft.description.trim().length > 0;
  }, [draft, photoIds]);

  const createMut = useMutation({
    mutationFn: (payload: any) => createPunchItem({ data: payload }),
    onSuccess: (row) => {
      toast.success(`${row.punch_number} added`);
      setAdded((prev) => [{ number: row.punch_number, description: row.description }, ...prev]);
      // Reset transient fields, keep project/area/discipline for streak entry.
      setDraft((d) =>
        makeDraft({
          projectId: d.projectId,
          walkDate: d.walkDate,
          area: d.area,
          discipline: d.discipline,
          category: d.category,
        }),
      );
      setPhotoIds([]);
      setPhotoPreviews([]);
      qc.invalidateQueries({ queryKey: ["qaqc", "punch"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!draft.projectId) {
      toast.error("Pick a project first.");
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const signed = await signPunchPhotoUpload({
          data: {
            projectId: draft.projectId,
            walkDate: draft.walkDate,
            fileName: file.name || `photo-${Date.now()}.jpg`,
          },
        });
        const put = await fetch(signed.signedUrl, {
          method: "PUT",
          headers: {
            "content-type": file.type || "image/jpeg",
            "x-upsert": "true",
          },
          body: file,
        });
        if (!put.ok) throw new Error(`upload failed (${put.status})`);
        const row = await registerPunchPhoto({
          data: {
            projectId: draft.projectId,
            filePath: signed.path,
            discipline: draft.discipline,
            area: draft.area || null,
          },
        });
        const url = URL.createObjectURL(file);
        setPhotoIds((p) => [...p, row.id]);
        setPhotoPreviews((p) => [...p, { id: row.id, url }]);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(id: string) {
    setPhotoIds((p) => p.filter((x) => x !== id));
    setPhotoPreviews((p) => p.filter((x) => x.id !== id));
  }

  function submit() {
    if (!canSubmit) return;
    createMut.mutate({
      projectId: draft.projectId,
      walkDate: draft.walkDate,
      area: draft.area.trim(),
      discipline: draft.discipline,
      category: draft.category,
      description: draft.description.trim(),
      dueDate: draft.dueDate || null,
      assignedTo: draft.assignedTo || null,
      photoIds,
    });
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-4 p-3 pb-28 md:p-6">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/qaqc/punch">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Punch walk</h1>
          <p className="text-xs text-muted-foreground">
            Snap, tag, save. {added.length} added this session.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <Field label="Project">
            <Select
              value={draft.projectId || undefined}
              onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Choose project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Walk date">
              <Input
                type="date"
                value={draft.walkDate}
                onChange={(e) => setDraft((d) => ({ ...d, walkDate: e.target.value }))}
                className="min-h-11"
              />
            </Field>
            <Field label="Area">
              <Input
                value={draft.area}
                onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}
                placeholder="e.g. Block A row 3"
                className="min-h-11"
              />
            </Field>
          </div>
          <Field label="Discipline">
            <Tabs
              value={draft.discipline}
              onValueChange={(v) => setDraft((d) => ({ ...d, discipline: v as QaqcDiscipline }))}
            >
              <TabsList className="w-full">
                {QAQC_DISCIPLINES.map((d) => (
                  <TabsTrigger key={d} value={d} className="flex-1">
                    {QAQC_DISCIPLINE_LABELS[d]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </Field>
          <Field label="Category">
            <div className="grid grid-cols-3 gap-2">
              {PUNCH_CATEGORIES.map((cat) => {
                const active = draft.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, category: cat }))}
                    className={`min-h-11 rounded-md border px-2 py-1 text-left text-xs transition ${
                      active
                        ? punchCategoryTint(cat) + " ring-2 ring-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary"
                    }`}
                  >
                    <div className="text-sm font-semibold">{PUNCH_CATEGORY_LABELS[cat]}</div>
                    <div className="mt-0.5 text-[10px] leading-tight opacity-80">
                      {PUNCH_CATEGORY_DESCRIPTIONS[cat]}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="What needs to change?"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due">
              <Input
                type="date"
                value={draft.dueDate}
                onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                className="min-h-11"
              />
            </Field>
            <Field label="Assign to">
              <Select
                value={draft.assignedTo || "none"}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    assignedTo: v === "none" ? "" : v,
                  }))
                }
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(walkCtxQuery.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.email ?? m.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={`Photos (${photoIds.length})`}>
            <div className="flex flex-wrap gap-2">
              {photoPreviews.map((p) => (
                <div
                  key={p.id}
                  className="relative h-20 w-20 overflow-hidden rounded-md border border-border"
                >
                  <img src={p.url} alt="punch" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-foreground shadow"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={uploading || !draft.projectId}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
                <span className="text-[10px]">Camera</span>
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                disabled={uploading || !draft.projectId}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">Gallery</span>
              </button>
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </Field>
        </CardContent>
      </Card>

      {added.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Added this session
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {added.map((a) => (
                <li key={a.number} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span className="font-mono text-xs text-muted-foreground">{a.number}</span>
                  <span className="truncate">{a.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <Badge variant="outline" className="min-h-11 px-3">
            {photoIds.length} photo{photoIds.length === 1 ? "" : "s"}
          </Badge>
          <Button
            className="min-h-11 flex-1"
            disabled={!canSubmit || createMut.isPending}
            onClick={submit}
          >
            {createMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Save & add next
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => navigate({ to: "/qaqc/punch" })}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
