// P-153 — PV layout workspace: automatic arrangement, compliance and alternatives.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMemo, useState } from "react";

import { PvLayoutCanvas } from "@/components/engineering/pv-layout-canvas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPvEquipment } from "@/lib/pv-library.functions";
import { pvEquipmentListQueryOptions } from "@/lib/pv-library-query";
import { getPvLayoutWriteAccess, listPvLayouts } from "@/lib/pv-layout.functions";
import {
  pvLayoutWriteAccessQueryOptions,
  pvLayoutsQueryOptions,
  useCreatePvLayout,
  useDecidePvLayoutApproval,
  useSubmitPvLayout,
} from "@/lib/pv-layout-query";
import { getActivePvSiteConfig } from "@/lib/pv-site.functions";
import { activePvSiteConfigQueryOptions } from "@/lib/pv-site-query";
import { ringToLocal, type Ring } from "@/lib/pv-site.geo";
import {
  generateAlternatives,
  type ComplianceFinding,
  type LayoutAlternative,
} from "@/lib/pv/layout";
import { generateSldFromLayout } from "@/lib/pv-sld.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/pv-layout")({
  component: PvLayoutPage,
  head: () => ({
    meta: [
      { title: "PV layout — GridMind EPC" },
      {
        name: "description",
        content:
          "Automatic PV block arrangement, compliance checking and side-by-side layout alternatives.",
      },
      { property: "og:title", content: "PV layout — GridMind EPC" },
      {
        property: "og:description",
        content: "Arrange arrays, roads and pads, then compare layout options before approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

interface Params {
  gcr: number;
  setbackM: number;
  tiltDeg: number;
  azimuthDeg: number;
  modulesAcross: number;
  modulesUp: number;
  roadEveryNRows: number;
  roadWidthM: number;
  tracker: boolean;
}

const DEFAULTS: Params = {
  gcr: 0.35,
  setbackM: 10,
  tiltDeg: 25,
  azimuthDeg: 180,
  modulesAcross: 28,
  modulesUp: 2,
  roadEveryNRows: 6,
  roadWidthM: 6,
  tracker: false,
};

function PvLayoutPage() {
  const { projectId } = Route.useParams();
  const activeSiteFn = useServerFn(getActivePvSiteConfig);
  const layoutsFn = useServerFn(listPvLayouts);
  const accessFn = useServerFn(getPvLayoutWriteAccess);
  const equipmentFn = useServerFn(listPvEquipment);

  const siteQuery = useQuery(activePvSiteConfigQueryOptions(activeSiteFn, projectId));
  const layoutsQuery = useQuery(pvLayoutsQueryOptions(layoutsFn, projectId));
  const accessQuery = useQuery(pvLayoutWriteAccessQueryOptions(accessFn));
  const modulesQuery = useQuery(
    pvEquipmentListQueryOptions(equipmentFn, {
      category: "module",
      search: null,
      activeOnly: true,
    }),
  );

  const [params, setParams] = useState<Params>(DEFAULTS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [highlighted, setHighlighted] = useState<string[]>([]);

  const canWrite = accessQuery.data?.canWrite ?? false;
  const site = siteQuery.data?.config ?? null;
  const moduleRow = modulesQuery.data?.[0] ?? null;

  const geometry = useMemo(() => {
    if (!site || site.latitude === null || site.longitude === null) return null;
    const ring = (site.boundary?.coordinates?.[0] ?? []) as Ring;
    if (ring.length < 4) return null;
    const anchor = { lat: site.latitude, lon: site.longitude };
    return {
      anchor,
      boundary: ringToLocal(ring, anchor),
      exclusions: (site.exclusions ?? []).map((e: (typeof site.exclusions)[number]) =>
        ringToLocal((e.polygon?.coordinates?.[0] ?? []) as Ring, anchor),
      ),
    };
  }, [site]);

  const alternatives: LayoutAlternative[] = useMemo(() => {
    if (!geometry || !moduleRow) return [];
    const dims = moduleRow.dimensions ?? {};
    const lengthMm = Number(dims.length_mm ?? dims.height_mm ?? 2278);
    const widthMm = Number(dims.width_mm ?? 1134);
    const moduleWp = Number(moduleRow.electrical?.pmax_w ?? 0) || 580;
    return generateAlternatives(
      {
        boundary: geometry.boundary,
        exclusionZones: geometry.exclusions,
        latitude: site?.latitude ?? 0,
        terrainRef: null,
        equipmentPads: [
          { label: "Inverter station", widthM: 12, depthM: 6, count: 2, type: "inverter_station" },
          { label: "Transformer pad", widthM: 8, depthM: 6, count: 1 },
        ],
      },
      {
        module: { lengthMm, widthMm },
        moduleWp,
        orientation: "portrait",
        modulesAcross: params.modulesAcross,
        modulesUp: params.modulesUp,
        tiltDeg: params.tiltDeg,
        azimuthDeg: params.azimuthDeg,
        gcr: params.gcr,
        setbackM: params.setbackM,
        roadEveryNRows: params.roadEveryNRows,
        roadWidthM: params.roadWidthM,
        tracker: params.tracker,
      },
    );
  }, [geometry, moduleRow, params, site]);

  const current = alternatives[activeOption] ?? null;
  const selectedBlock = current?.result.blocks.find((b) => b.key === selectedKey) ?? null;

  const generateSldFn = useServerFn(generateSldFromLayout);
  const navigate = useNavigate();
  const generateSld = useMutation({
    mutationFn: (layoutId: string) => generateSldFn({ data: { layoutId } }),
    onSuccess: (result) => {
      const diff = result.diff;
      const summary = diff
        ? ` — ${diff.added.length} added, ${diff.removed.length} removed, ${diff.unchanged} unchanged`
        : "";
      if (!result.persisted) {
        toast.warning(result.note ?? "Preview only", {
          description: `${result.counts.objects} objects and ${result.counts.connections} connections were generated but not saved.`,
        });
        return;
      }
      toast.success(`SLD generated${summary}`, {
        description: `${result.counts.objects} objects, ${result.counts.connections} connections${
          result.warnings.length > 0 ? `, ${result.warnings.length} warning(s)` : ""
        }.`,
        action: {
          label: "Open drawing",
          onClick: () =>
            navigate({
              to: "/projects/$projectId/engineering/sld-cad/$drawingId",
              params: { projectId, drawingId: result.drawingId as string },
            }),
        },
      });
    },
    onError: (error: Error) => toast.error(error.message || "Could not generate the SLD."),
  });

  const createLayout = useCreatePvLayout(projectId);
  const submitLayout = useSubmitPvLayout(projectId);
  const decideLayout = useDecidePvLayoutApproval(projectId);

  function persist(alt: LayoutAlternative) {
    if (!moduleRow) return;
    createLayout.mutate({
      projectId,
      siteConfigId: site?.id ?? null,
      name: alt.name,
      params: {
        module_id: moduleRow.id,
        structure_id: null,
        tracker_id: null,
        orientation: alt.params.orientation,
        modules_across: alt.params.modulesAcross,
        modules_up: alt.params.modulesUp,
        tilt_deg: alt.params.tracker ? 0 : alt.params.tiltDeg,
        azimuth_deg: alt.params.azimuthDeg,
        pitch_m: alt.pitchM,
        row_spacing_m: Math.max(0, alt.pitchM - alt.table.collectorWidthM),
        gcr: alt.params.gcr,
        setback_m: alt.params.setbackM,
        road_width_m: alt.params.roadWidthM,
        corridor_width_m: 4,
        module_wp: alt.params.moduleWp,
      },
      totals: {
        module_count: alt.result.metrics.moduleCount,
        table_count: alt.result.metrics.tableCount,
        block_count: alt.result.blocks.length,
        dc_kwp: alt.result.metrics.dcKwp,
        used_area_m2: alt.result.metrics.usedAreaM2,
        boundary_area_m2: alt.result.metrics.boundaryAreaM2,
        compliance: {
          status: alt.result.compliance.status,
          warnings: alt.result.compliance.warningCount,
          failures: alt.result.compliance.failureCount,
          achieved_gcr: alt.result.metrics.achievedGcr,
        },
      },
      blocks: alt.result.blocks.map((b, i) => ({
        block_type: b.type,
        label: b.label,
        geometry: {
          polygon: b.polygon.map((p) => [p.x, p.y] as [number, number]),
          rotation_deg: alt.params.azimuthDeg,
        },
        equipment_id: b.type === "array_table" ? moduleRow.id : null,
        module_rows: b.type === "array_table" ? alt.params.modulesUp : null,
        modules_per_row: b.type === "array_table" ? alt.params.modulesAcross : null,
        module_count: b.moduleCount,
        dc_kwp: b.dcKwp,
        sort_order: i,
      })),
    } as any);
  }

  function focusFinding(finding: ComplianceFinding) {
    const keys =
      current?.result.blocks.filter((b) => finding.blocks.includes(b.label)).map((b) => b.key) ??
      [];
    setHighlighted(keys);
    setSelectedKey(keys[0] ?? null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="PV layout"
        description="Automatic block arrangement, compliance checks and layout alternatives."
      />

      {!geometry ? (
        <EmptyState
          title="No active site configuration"
          description="Draw the site boundary and activate a configuration on the Site config tab before arranging a layout."
        />
      ) : !moduleRow ? (
        <EmptyState
          title="No PV module in the library"
          description="Add at least one active module to the PV equipment library to size tables."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Arrangement parameters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {(
                [
                  ["gcr", "GCR", 0.01],
                  ["setbackM", "Setback (m)", 1],
                  ["tiltDeg", "Tilt (deg)", 1],
                  ["azimuthDeg", "Azimuth (deg)", 1],
                  ["modulesAcross", "Modules across", 1],
                  ["modulesUp", "Modules up", 1],
                  ["roadEveryNRows", "Road every N rows", 1],
                  ["roadWidthM", "Road width (m)", 1],
                ] as const
              ).map(([key, label, step]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`param-${key}`}>{label}</Label>
                  <Input
                    id={`param-${key}`}
                    type="number"
                    step={step}
                    value={params[key]}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {alternatives.map((alt, i) => (
              <Button
                key={alt.option}
                variant={i === activeOption ? "default" : "outline"}
                onClick={() => {
                  setActiveOption(i);
                  setSelectedKey(null);
                  setHighlighted([]);
                }}
              >
                {alt.name}
              </Button>
            ))}
          </div>

          {current ? (
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-2">
                <PvLayoutCanvas
                  boundary={geometry.boundary}
                  exclusions={geometry.exclusions}
                  blocks={current.result.blocks}
                  selectedKey={selectedKey}
                  highlightedKeys={highlighted}
                  onSelect={(k) => {
                    setSelectedKey(k);
                    setHighlighted([]);
                  }}
                />
                <p className="text-sm text-muted-foreground">{current.rationale}</p>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Block inspector</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {selectedBlock ? (
                      <>
                        <p className="font-medium text-foreground">{selectedBlock.label}</p>
                        <p className="text-muted-foreground">Type: {selectedBlock.type}</p>
                        <p className="text-muted-foreground">
                          Modules: {selectedBlock.moduleCount} — {selectedBlock.dcKwp.toFixed(2)}{" "}
                          kWp
                        </p>
                        <p className="text-muted-foreground">
                          Slope:{" "}
                          {selectedBlock.slopePct === undefined
                            ? "no terrain data"
                            : `${selectedBlock.slopePct.toFixed(1)}%`}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Select a block on the canvas.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Compliance
                      <StatusBadge status={current.result.compliance.status} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {current.result.compliance.checks.map((check) => (
                      <div key={check.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{check.title}</span>
                          <StatusBadge status={check.status} />
                        </div>
                        {check.findings.map((finding, i) => (
                          <button
                            key={`${check.id}-${i}`}
                            type="button"
                            onClick={() => focusFinding(finding)}
                            className={cn(
                              "block w-full rounded-md px-2 py-1 text-left text-xs",
                              check.status === "fail"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {finding.message}
                            {finding.coordinates?.length ? (
                              <span className="block opacity-80">
                                {finding.coordinates
                                  .slice(0, 3)
                                  .map((c) => `(${c.x.toFixed(1)}, ${c.y.toFixed(1)})`)
                                  .join(" ")}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {canWrite ? (
                  <Button onClick={() => persist(current)} disabled={createLayout.isPending}>
                    Save {current.name} as draft
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Option comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Option</TableHead>
                    <TableHead>DC kWp</TableHead>
                    <TableHead>Modules</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead>Used area (m²)</TableHead>
                    <TableHead>Achieved GCR</TableHead>
                    <TableHead>Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alternatives.map((alt) => (
                    <TableRow key={alt.option}>
                      <TableCell>{alt.name}</TableCell>
                      <TableCell>{alt.result.metrics.dcKwp.toFixed(1)}</TableCell>
                      <TableCell>{alt.result.metrics.moduleCount}</TableCell>
                      <TableCell>{alt.result.metrics.tableCount}</TableCell>
                      <TableCell>{Math.round(alt.result.metrics.usedAreaM2)}</TableCell>
                      <TableCell>{alt.result.metrics.achievedGcr.toFixed(3)}</TableCell>
                      <TableCell>
                        {alt.result.compliance.warningCount + alt.result.compliance.failureCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved layouts</CardTitle>
            </CardHeader>
            <CardContent>
              {(layoutsQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No saved layouts"
                  description="Save an option above to start the approval workflow."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Layout</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>DC kWp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(layoutsQuery.data ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {row.layout_number} — {row.name}
                        </TableCell>
                        <TableCell>v{row.version}</TableCell>
                        <TableCell>{Number(row.totals?.dc_kwp ?? 0).toFixed(1)}</TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="space-x-2 text-right">
                          {canWrite && row.status === "draft" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => submitLayout.mutate(row.id)}
                              disabled={submitLayout.isPending}
                            >
                              Submit for approval
                            </Button>
                          ) : null}
                          {canWrite && row.status === "approved" ? (
                            <Button
                              size="sm"
                              onClick={() => generateSld.mutate(row.id)}
                              disabled={generateSld.isPending}
                            >
                              Generate SLD
                            </Button>
                          ) : null}
                          {canWrite && row.status === "under_review" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decideLayout.mutate(row.id)}
                              disabled={decideLayout.isPending}
                            >
                              Apply decision
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
