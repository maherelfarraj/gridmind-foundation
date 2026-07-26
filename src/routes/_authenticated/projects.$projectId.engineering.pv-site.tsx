// P-151 — PV site configuration workspace (geometry + weather/losses).
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PvGeometryTab } from "@/components/engineering/pv-geometry-tab";
import { PvWeatherTab } from "@/components/engineering/pv-weather-tab";
import {
  closeRing,
  m2ToHectares,
  openRing,
  polygonAreaM2,
  ringToLocal,
  validateRing,
  type Ring,
} from "@/lib/pv-site.geo";
import {
  defaultWeatherMeta,
  pvSiteConfigSchema,
  type PvExclusion,
  type PvSiteConfigRow,
  type PvWeatherMeta,
  type PvWeatherSource,
} from "@/lib/pv-site.schemas";
import {
  getPvSiteWriteAccess,
  listPvSiteConfigs,
} from "@/lib/pv-site.functions";
import {
  pvSiteConfigsQueryOptions,
  pvSiteWriteAccessQueryOptions,
  useActivatePvSiteConfig,
  useSavePvSiteConfig,
} from "@/lib/pv-site-query";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/pv-site")({
  head: () => ({
    meta: [
      { title: "PV site configuration — GridMind EPC" },
      {
        name: "description",
        content:
          "Define the site boundary, exclusion zones, weather dataset, loss assumptions, grid limits and capacity targets for the PV plant.",
      },
      { property: "og:title", content: "PV site configuration — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Boundary and exclusion editor, weather dataset picker and loss assumptions for the PV plant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PvSitePage,
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-8 text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load site configuration."}
      </CardContent>
    </Card>
  ),
});

interface Draft {
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  albedo: number;
  weather_source: PvWeatherSource;
  meta: PvWeatherMeta;
  boundary: Ring;
  exclusions: PvExclusion[];
}

function rowToDraft(row: PvSiteConfigRow | null): Draft {
  if (!row) {
    return {
      id: null,
      name: "Base case",
      latitude: 31.9,
      longitude: 36.1,
      albedo: 0.2,
      weather_source: "typical_year",
      meta: defaultWeatherMeta(),
      boundary: [],
      exclusions: [],
    };
  }
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude ?? 31.9,
    longitude: row.longitude ?? 36.1,
    albedo: row.albedo,
    weather_source: row.weather_source,
    meta: row.weather_meta,
    boundary: (row.boundary.coordinates?.[0] ?? []) as Ring,
    exclusions: row.exclusions,
  };
}

function PvSitePage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listPvSiteConfigs);
  const accessFn = useServerFn(getPvSiteWriteAccess);

  const listQuery = useQuery(pvSiteConfigsQueryOptions(listFn, projectId));
  const accessQuery = useSuspenseQuery(pvSiteWriteAccessQueryOptions(accessFn));
  const readOnly = !accessQuery.data.canWrite;

  const configs = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => rowToDraft(null));

  const selected = useMemo(
    () => configs.find((c) => c.id === selectedId) ?? null,
    [configs, selectedId],
  );

  // Hydrate the draft when a different stored revision becomes current, not on
  // every refetch — otherwise in-progress edits would be wiped mid-typing.
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!listQuery.isSuccess) return;
    const next = selectedId
      ? (configs.find((c) => c.id === selectedId) ?? null)
      : (configs.find((c) => c.status === "active") ?? configs[0] ?? null);
    const key = next ? `${next.id}:${next.updated_at}:${next.status}` : "new";
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    if (next && next.id !== selectedId) setSelectedId(next.id);
    setDraft(rowToDraft(next));
  }, [listQuery.isSuccess, configs, selectedId]);


  const save = useSavePvSiteConfig(projectId);
  const activate = useActivatePvSiteConfig(projectId);

  const anchor = { lat: draft.latitude, lon: draft.longitude };
  const grossM2 = polygonAreaM2(ringToLocal(draft.boundary, anchor));
  const exclusionM2 = draft.exclusions.reduce(
    (sum, e) => sum + polygonAreaM2(ringToLocal((e.polygon.coordinates?.[0] ?? []) as Ring, anchor)),
    0,
  );
  const usableHa = m2ToHectares(Math.max(grossM2 - exclusionM2, 0));

  const patchMeta = (patch: Partial<PvWeatherMeta>) =>
    setDraft((d) => ({ ...d, meta: { ...d.meta, ...patch } }));

  const onSave = () => {
    const boundaryRing = openRing(draft.boundary);
    if (boundaryRing.length > 0 && boundaryRing.length < 3) {
      toast.error("A boundary needs at least 3 vertices.");
      return;
    }
    if (boundaryRing.length >= 3) {
      const issue = validateRing(draft.boundary);
      if (issue) {
        toast.error(issue.message);
        return;
      }
    }
    for (const e of draft.exclusions) {
      const ring = (e.polygon.coordinates?.[0] ?? []) as Ring;
      if (openRing(ring).length === 0) continue;
      const issue = validateRing(ring);
      if (issue) {
        toast.error(`${e.name}: ${issue.message}`);
        return;
      }
    }

    const payload = {
      id: draft.id,
      projectId,
      name: draft.name,
      latitude: draft.latitude,
      longitude: draft.longitude,
      albedo: draft.albedo,
      weather_source: draft.weather_source,
      weather_meta: draft.meta,
      boundary: {
        type: "Polygon" as const,
        coordinates: boundaryRing.length >= 3 ? [closeRing(draft.boundary)] : [],
      },
      exclusions: draft.exclusions
        .filter((e) => openRing((e.polygon.coordinates?.[0] ?? []) as Ring).length >= 3)
        .map((e) => ({
          ...e,
          polygon: {
            type: "Polygon" as const,
            coordinates: [closeRing((e.polygon.coordinates?.[0] ?? []) as Ring)],
          },
        })),
      usable_area_ha: Number(usableHa.toFixed(4)),
    };

    const parsed = pvSiteConfigSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Configuration is invalid.");
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: (res) => setSelectedId(res.id),
    });
  };

  if (listQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[560px] w-full" />
      </div>
    );
  }

  if (listQuery.error) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">
          {(listQuery.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Site configuration"
        description="Boundary, exclusions, weather dataset and loss assumptions feeding layout, stringing and yield."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selected ? (
              <Badge variant={selected.status === "active" ? "default" : "outline"}>
                {selected.status}
              </Badge>
            ) : (
              <Badge variant="outline">new</Badge>
            )}
            <Button variant="outline" onClick={onSave} disabled={readOnly || save.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              onClick={() => selected && activate.mutate(selected.id)}
              disabled={
                readOnly || !selected || selected.status === "active" || activate.isPending
              }
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Activate
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="config-name">Configuration name</Label>
          <Input
            id="config-name"
            className="w-64"
            value={draft.name}
            disabled={readOnly}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        {configs.length > 0 ? (
          <div className="space-y-1.5">
            <Label>Open configuration</Label>
            <Select value={selectedId ?? ""} onValueChange={(v) => setSelectedId(v)}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — {c.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {!readOnly ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedId(null);
              setDraft({ ...rowToDraft(null), name: `Scenario ${configs.length + 1}` });
            }}
          >
            New scenario
          </Button>
        ) : null}
        <Badge variant="outline" className="ml-auto">
          Usable area {usableHa.toFixed(2)} ha
        </Badge>
      </div>

      <Tabs defaultValue="geometry" className="space-y-4">
        <TabsList>
          <TabsTrigger value="geometry">Geometry</TabsTrigger>
          <TabsTrigger value="weather">Weather &amp; losses</TabsTrigger>
        </TabsList>
        <TabsContent value="geometry">
          <PvGeometryTab
            latitude={draft.latitude}
            longitude={draft.longitude}
            boundary={draft.boundary}
            exclusions={draft.exclusions}
            meta={draft.meta}
            readOnly={readOnly}
            onAnchorChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onBoundaryChange={(ring) => setDraft((d) => ({ ...d, boundary: ring }))}
            onExclusionsChange={(exclusions) => setDraft((d) => ({ ...d, exclusions }))}
            onMetaChange={patchMeta}
          />
        </TabsContent>
        <TabsContent value="weather">
          <PvWeatherTab
            projectId={projectId}
            weatherSource={draft.weather_source}
            albedo={draft.albedo}
            meta={draft.meta}
            readOnly={readOnly}
            onWeatherSourceChange={(weather_source) => setDraft((d) => ({ ...d, weather_source }))}
            onAlbedoChange={(albedo) => setDraft((d) => ({ ...d, albedo }))}
            onMetaChange={patchMeta}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
