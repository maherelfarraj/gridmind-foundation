// P-162 — Civil feature editor: draw roads, trenches, platforms, fences, access; KML/GeoJSON IO.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Lock, Redo2, Save, Trash2, Undo2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CivilFeatureCanvas } from "@/components/engineering/civil-feature-canvas";
import {
  CIVIL_TYPE_LIST,
  CIVIL_TYPE_SPECS,
  geometryKindFor,
  isCivilFeatureType,
  isReadOnlyStatus,
  minVertices,
  type CivilFeatureType,
  type CivilTypeSpec,
} from "@/lib/civil/feature-types";
import {
  geometryFromVertices,
  geometryVertexLists,
  measureGeometry,
  replaceVertex,
  type GeoJsonGeometry,
  type Vertex,
} from "@/lib/civil/geom";
import { geometryToLocal, parseKml } from "@/lib/civil/kml";
import { collectKinds, parseGeoJSON } from "@/lib/geojson";
import {
  civilFeaturesQueryOptions,
  parseServerError,
  useCivilMutation,
  useInvalidateCivilFeatures,
} from "@/lib/civil-query";
import {
  deleteCivilFeature,
  exportCivilFeatures,
  importCivilFeatures,
  listCivilFeatures,
  reviseCivilFeature,
  saveCivilFeature,
  suggestCivilFeatureRef,
  type CivilFeatureRow,
} from "@/lib/civil.functions";
import { getTerrainWriteAccess } from "@/lib/terrain.functions";
import { terrainWriteAccessQueryOptions } from "@/lib/terrain-query";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/civil-features",
)({
  head: () => ({
    meta: [
      { title: "Civil feature editor — GridMind EPC" },
      {
        name: "description",
        content:
          "Draw and revise roads, trenches, platforms, fences and access routes on the project site grid, with GeoJSON and KML import/export.",
      },
      { property: "og:title", content: "Civil feature editor — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Site civil drafting for renewable EPC: roads, trenches, platforms, laydown, drainage and access control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CivilFeatureEditorPage,
});

type PendingImport = {
  source: "geojson" | "kml";
  rows: Array<{ name: string; kind: string; geometry: GeoJsonGeometry }>;
  mapping: Record<string, CivilFeatureType | "">;
};

function download(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function CivilFeatureEditorPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listCivilFeatures);
  const accessFn = useServerFn(getTerrainWriteAccess);
  const saveFn = useServerFn(saveCivilFeature);
  const deleteFn = useServerFn(deleteCivilFeature);
  const reviseFn = useServerFn(reviseCivilFeature);
  const importFn = useServerFn(importCivilFeatures);
  const exportFn = useServerFn(exportCivilFeatures);
  const suggestFn = useServerFn(suggestCivilFeatureRef);
  const invalidate = useInvalidateCivilFeatures(projectId);

  const featuresQuery = useQuery(civilFeaturesQueryOptions(listFn, projectId));
  const accessQuery = useQuery(terrainWriteAccessQueryOptions(accessFn));
  const canWrite = accessQuery.data?.canWrite ?? false;

  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(
    () => new Set(CIVIL_TYPE_LIST.map((t) => t.type)),
  );
  const [activeTool, setActiveTool] = useState<CivilFeatureType | null>(null);
  const [draft, setDraft] = useState<Vertex[]>([]);
  const [history, setHistory] = useState<Vertex[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapStep, setSnapStep] = useState(0.5);
  const [editGeometry, setEditGeometry] = useState<GeoJsonGeometry | null>(null);
  const [form, setForm] = useState<{
    name: string;
    status: string;
    properties: Record<string, string>;
  }>({ name: "", status: "draft", properties: {} });
  const [suggestedRef, setSuggestedRef] = useState<string>("");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const features = useMemo(() => featuresQuery.data ?? [], [featuresQuery.data]);
  const selected = useMemo(
    () => features.find((f) => f.id === selectedId) ?? null,
    [features, selectedId],
  );
  const selectedSpec: CivilTypeSpec | null = selected
    ? (CIVIL_TYPE_SPECS[selected.feature_type as CivilFeatureType] ?? null)
    : null;
  const selectedLocked = selected ? isReadOnlyStatus(selected.status) : false;

  useEffect(() => {
    if (!selected) {
      setEditGeometry(null);
      return;
    }
    setEditGeometry(selected.geometry as GeoJsonGeometry);
    setForm({
      name: selected.name,
      status: selected.status,
      properties: Object.fromEntries(
        Object.entries(selected.properties ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]),
      ),
    });
  }, [selected]);

  useEffect(() => {
    if (!activeTool) return;
    void suggestFn({ data: { projectId } })
      .then((r) => setSuggestedRef(r.featureRef))
      .catch(() => setSuggestedRef(""));
  }, [activeTool, projectId, suggestFn]);

  /* ---------------- undo / redo of the drawing session ---------------- */
  const pushHistory = useCallback(
    (vertices: Vertex[]) => {
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), vertices]);
      setHistoryIndex((i) => i + 1);
      setDraft(vertices);
    },
    [historyIndex],
  );
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    setDraft(history[next] ?? []);
  }, [history, historyIndex]);
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const next = historyIndex + 1;
    setHistoryIndex(next);
    setDraft(history[next] ?? []);
  }, [history, historyIndex]);
  const resetSession = useCallback(() => {
    setDraft([]);
    setHistory([[]]);
    setHistoryIndex(0);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      if (ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ------------------------------ mutations --------------------------- */
  const saveMutation = useCivilMutation<Record<string, unknown>, CivilFeatureRow>(saveFn as never, {
    onSuccess: (row) => {
      toast.success(`${row.feature_ref} saved`);
      setSelectedId(row.id);
      resetSession();
      setActiveTool(null);
      void invalidate();
    },
    onError: (message) => toast.error(message),
  });

  const deleteMutation = useCivilMutation<{ id: string }, { deleted: true }>(deleteFn as never, {
    onSuccess: () => {
      toast.success("Civil feature deleted");
      setSelectedId(null);
      void invalidate();
    },
    onError: (message) => toast.error(message),
  });

  const reviseMutation = useCivilMutation<{ id: string }, CivilFeatureRow>(reviseFn as never, {
    onSuccess: (row) => {
      toast.success(`Revision ${row.revision_code} opened for editing`);
      void invalidate();
    },
    onError: (message) => toast.error(message),
  });

  const importMutation = useCivilMutation<Record<string, unknown>, { imported: number }>(
    importFn as never,
    {
      onSuccess: (res) => {
        toast.success(`${res.imported} feature(s) imported as drafts`);
        setPendingImport(null);
        void invalidate();
      },
      onError: (message) => toast.error(message),
    },
  );

  /* ------------------------------ drawing ----------------------------- */
  const finishDraft = useCallback(() => {
    if (!activeTool) return;
    const kind = geometryKindFor(activeTool) ?? "line";
    if (draft.length < minVertices(kind)) {
      toast.error(
        `A ${CIVIL_TYPE_SPECS[activeTool].label} needs at least ${minVertices(kind)} point(s).`,
      );
      return;
    }
    const geometry = geometryFromVertices(kind, draft);
    if (!geometry) return;
    saveMutation.mutate({
      projectId,
      featureType: activeTool,
      name: `${CIVIL_TYPE_SPECS[activeTool].label} ${suggestedRef || ""}`.trim(),
      featureRef: suggestedRef || null,
      geometry,
      properties: {},
      status: "draft",
    } as never);
  }, [activeTool, draft, projectId, saveMutation, suggestedRef]);

  const measure = useMemo(() => {
    if (activeTool && draft.length) {
      return measureGeometry(geometryKindFor(activeTool) ?? "line", draft);
    }
    if (editGeometry) {
      const kind = geometryKindFor(selected?.feature_type ?? "") ?? "line";
      return measureGeometry(kind, geometryVertexLists(editGeometry)[0] ?? []);
    }
    return null;
  }, [activeTool, draft, editGeometry, selected]);

  /* ------------------------------ import ------------------------------ */
  const onFile = async (file: File) => {
    const text = await file.text();
    try {
      if (file.name.toLowerCase().endsWith(".kml")) {
        const placemarks = parseKml(text);
        setPendingImport({
          source: "kml",
          rows: placemarks.map((p) => ({
            name: p.name,
            kind: p.geometry.type,
            geometry: geometryToLocal(p.geometry, { lon: 0, lat: 0 }),
          })),
          mapping: Object.fromEntries(
            Array.from(new Set(placemarks.map((p) => p.geometry.type))).map((k) => [k, ""]),
          ) as PendingImport["mapping"],
        });
      } else {
        const collection = parseGeoJSON(text);
        setPendingImport({
          source: "geojson",
          rows: collection.features.map((f, i) => ({
            name: String(f.properties?.name ?? `Imported feature ${i + 1}`),
            kind: String(f.properties?.kind ?? ""),
            geometry: f.geometry as GeoJsonGeometry,
          })),
          mapping: Object.fromEntries(
            collectKinds(collection).map((k) => [k, isCivilFeatureType(k) ? k : ""]),
          ) as PendingImport["mapping"],
        });
      }
    } catch (err) {
      toast.error(parseServerError(err, "Could not read that file."));
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    const rows = pendingImport.rows
      .map((row) => {
        const type = pendingImport.mapping[row.kind] || "";
        if (!isCivilFeatureType(type)) return null;
        return {
          name: row.name.slice(0, 120),
          featureType: type,
          geometry: row.geometry,
          properties: {},
        };
      })
      .filter(Boolean) as Array<{
      name: string;
      featureType: CivilFeatureType;
      geometry: GeoJsonGeometry;
      properties: Record<string, unknown>;
    }>;
    if (!rows.length) {
      toast.error("Map at least one kind to a civil feature type.");
      return;
    }
    importMutation.mutate({ projectId, source: pendingImport.source, features: rows } as never);
  };

  const runExport = async (format: "geojson" | "kml") => {
    try {
      const res = await exportFn({ data: { projectId, format } });
      download(res.fileName, res.mimeType, res.content);
      toast.success(`${res.count} feature(s) exported`);
    } catch (err) {
      toast.error(parseServerError(err, "Export is locked for this project."));
    }
  };

  const canvasFeatures = useMemo(
    () =>
      features.map((f) => ({
        id: f.id,
        feature_ref: f.feature_ref,
        name: f.name,
        feature_type: f.feature_type,
        status: f.status,
        geometry:
          f.id === selectedId && editGeometry ? editGeometry : (f.geometry as GeoJsonGeometry),
      })),
    [features, selectedId, editGeometry],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Civil feature editor"
        description="Draw roads, trenches, platforms, fences and access routes on the project grid. Imports land as drafts; approved features are read-only until revised."
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".geojson,.json,.kml"
              className="hidden"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) void onFile(file);
                ev.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={!canWrite}
            >
              <Upload className="mr-2 size-4" /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runExport("geojson")}>
              <Download className="mr-2 size-4" /> GeoJSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runExport("kml")}>
              <Download className="mr-2 size-4" /> KML
            </Button>
          </div>
        }
      />

      {featuresQuery.isLoading ? (
        <Skeleton className="h-[560px] w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
          {/* -------- tool palette + layers -------- */}
          <Card>
            <CardContent className="space-y-4 p-4">
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">Tools</h3>
                <div className="space-y-1">
                  {CIVIL_TYPE_LIST.map((spec) => (
                    <Button
                      key={spec.type}
                      size="sm"
                      variant={activeTool === spec.type ? "default" : "ghost"}
                      className="w-full justify-start"
                      disabled={!canWrite}
                      onClick={() => {
                        setActiveTool(activeTool === spec.type ? null : spec.type);
                        setSelectedId(null);
                        resetSession();
                      }}
                    >
                      <span
                        aria-hidden
                        className="mr-2 inline-block size-3 rounded-sm"
                        style={{ backgroundColor: `var(${spec.cssVar})` }}
                      />
                      <span className="truncate">{spec.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {spec.kind[0].toUpperCase()}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="snap" className="text-sm">
                    Snap to grid
                  </Label>
                  <Switch id="snap" checked={snapEnabled} onCheckedChange={setSnapEnabled} />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="snap-step" className="text-xs text-muted-foreground">
                    Step (m)
                  </Label>
                  <Input
                    id="snap-step"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={snapStep}
                    onChange={(ev) => setSnapStep(Math.max(0.1, Number(ev.target.value) || 0.5))}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="space-y-1 border-t border-border pt-3">
                <h3 className="mb-2 text-sm font-medium text-foreground">Layers</h3>
                {CIVIL_TYPE_LIST.map((spec) => (
                  <label
                    key={spec.type}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Checkbox
                      checked={visibleTypes.has(spec.type)}
                      onCheckedChange={(checked) =>
                        setVisibleTypes((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(spec.type);
                          else next.delete(spec.type);
                          return next;
                        })
                      }
                    />
                    {spec.label}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* -------- canvas -------- */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={undo} disabled={historyIndex <= 0}>
                <Undo2 className="mr-2 size-4" /> Undo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
              >
                <Redo2 className="mr-2 size-4" /> Redo
              </Button>
              {activeTool ? (
                <>
                  <Button size="sm" onClick={finishDraft} disabled={saveMutation.isPending}>
                    <Save className="mr-2 size-4" /> Finish {CIVIL_TYPE_SPECS[activeTool].label}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      resetSession();
                      setActiveTool(null);
                    }}
                  >
                    <X className="mr-2 size-4" /> Cancel
                  </Button>
                  <Badge variant="outline">{suggestedRef || "CVL-…"}</Badge>
                </>
              ) : null}
              {measure ? (
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {measure.areaM2
                    ? `area ${measure.areaM2.toLocaleString()} m² · perimeter ${measure.perimeterM.toLocaleString()} m`
                    : `length ${measure.lengthM.toLocaleString()} m`}
                </span>
              ) : null}
            </div>

            <CivilFeatureCanvas
              features={canvasFeatures}
              visibleTypes={visibleTypes}
              selectedId={selectedId}
              onSelect={(id) => {
                if (activeTool) return;
                setSelectedId(id);
              }}
              activeTool={activeTool}
              draft={draft}
              onDraftChange={pushHistory}
              onFinishDraft={finishDraft}
              onCancelDraft={() => {
                resetSession();
                setActiveTool(null);
              }}
              editable={Boolean(selected) && canWrite && !selectedLocked}
              onVertexMove={(part, index, position) =>
                setEditGeometry((prev) =>
                  prev ? replaceVertex(prev, part, index, position) : prev,
                )
              }
              snapEnabled={snapEnabled}
              snapStep={snapStep}
            />
          </div>

          {/* -------- properties -------- */}
          <Card>
            <CardContent className="space-y-4 p-4">
              {!selected ? (
                <EmptyState
                  title="No feature selected"
                  description="Pick a tool to draw, or click a feature on the canvas to edit its properties."
                />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm text-foreground">{selected.feature_ref}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedSpec?.label ?? selected.feature_type} · rev{" "}
                        {selected.revision_code}
                      </p>
                    </div>
                    <StatusBadge status={selected.status} />
                  </div>

                  {selectedLocked ? (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        This feature is {selected.status} and read-only. Create a new revision to
                        edit it.
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label htmlFor="feature-name">Name</Label>
                    <Input
                      id="feature-name"
                      value={form.name}
                      disabled={selectedLocked || !canWrite}
                      onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))}
                    />
                  </div>

                  {(selectedSpec?.fields ?? []).map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`fld-${field.key}`}>{field.label}</Label>
                      {field.options ? (
                        <Select
                          value={form.properties[field.key] ?? ""}
                          disabled={selectedLocked || !canWrite}
                          onValueChange={(value) =>
                            setForm((f) => ({
                              ...f,
                              properties: { ...f.properties, [field.key]: value },
                            }))
                          }
                        >
                          <SelectTrigger id={`fld-${field.key}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`fld-${field.key}`}
                          type={field.kind === "number" ? "number" : "text"}
                          value={form.properties[field.key] ?? ""}
                          disabled={selectedLocked || !canWrite}
                          onChange={(ev) =>
                            setForm((f) => ({
                              ...f,
                              properties: { ...f.properties, [field.key]: ev.target.value },
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}

                  <div className="space-y-2">
                    <Label htmlFor="feature-status">Status</Label>
                    <Select
                      value={form.status}
                      disabled={selectedLocked || !canWrite}
                      onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
                    >
                      <SelectTrigger id="feature-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="under_review">Under review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {selectedLocked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || reviseMutation.isPending}
                        onClick={() => reviseMutation.mutate({ id: selected.id })}
                      >
                        New revision
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!canWrite || saveMutation.isPending}
                        onClick={() =>
                          saveMutation.mutate({
                            id: selected.id,
                            projectId,
                            featureType: selected.feature_type,
                            name: form.name,
                            geometry: (editGeometry ?? selected.geometry) as GeoJsonGeometry,
                            properties: form.properties,
                            status: form.status,
                          } as never)
                        }
                      >
                        <Save className="mr-2 size-4" /> Save
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={!canWrite || selectedLocked || deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate({ id: selected.id })}
                    >
                      <Trash2 className="mr-2 size-4" /> Delete
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ------------- import kind-mapping dialog ------------- */}
      <Dialog
        open={Boolean(pendingImport)}
        onOpenChange={(open) => !open && setPendingImport(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map imported kinds</DialogTitle>
            <DialogDescription>
              {pendingImport?.rows.length ?? 0} geometry(ies) found. Map each source kind to a civil
              feature type — imported features land as drafts.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {Object.keys(pendingImport?.mapping ?? {}).map((kind) => (
              <div key={kind} className="flex items-center gap-3">
                <span className="w-40 truncate font-mono text-xs text-muted-foreground">
                  {kind || "(no kind)"}
                </span>
                <Select
                  value={pendingImport?.mapping[kind] || ""}
                  onValueChange={(value) =>
                    setPendingImport((prev) =>
                      prev
                        ? {
                            ...prev,
                            mapping: { ...prev.mapping, [kind]: value as CivilFeatureType },
                          }
                        : prev,
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Skip" />
                  </SelectTrigger>
                  <SelectContent>
                    {CIVIL_TYPE_LIST.map((spec) => (
                      <SelectItem key={spec.type} value={spec.type}>
                        {spec.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
            <Button onClick={confirmImport} disabled={importMutation.isPending}>
              Import as drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
