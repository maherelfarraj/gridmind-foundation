// P-183 — Discipline test records: welding, torque, cable, thermographic,
// relay, transformer — plus the calibration register that gates torque tools.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Plus } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { CalibrationChip, ResultBadge } from "@/components/quality/quality-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  createCableTest,
  createCalibration,
  createRelayTest,
  createThermographicInspection,
  createTorqueRecord,
  createTransformerTest,
  createWeldingRecord,
  getQualityAccess,
  listCalibrations,
  listTestRecords,
} from "@/lib/quality.functions";
import {
  CABLE_TEST_TYPES,
  RELAY_TEST_TYPES,
  TEST_RECORD_TAB_LABELS,
  TEST_RECORD_TABS,
  TRANSFORMER_TEST_TYPES,
  type TestResultStatus,
} from "@/lib/quality.rules";

export const Route = createFileRoute("/_authenticated/quality/test-records")({
  head: () => ({
    meta: [
      { title: "Test records — GridMind EPC" },
      {
        name: "description",
        content:
          "Welding, torque, cable, thermographic, relay and transformer test records with calibration control.",
      },
      { property: "og:title", content: "Test records — GridMind EPC" },
      {
        property: "og:description",
        content: "Discipline test records captured on site with calibrated instruments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TestRecordsPage,
});

type Row = Record<string, unknown>;
type CalRow = { instrument_tag: string; instrument: string; cal_date: string; next_due: string | null };

const today = () => new Date().toISOString().slice(0, 10);

function RowList({ rows, primary, secondary }: { rows: Row[]; primary: string; secondary: string }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={String(r.id)} className="flex flex-wrap items-center gap-3 py-3">
          <span className="font-medium text-foreground">{String(r[primary] ?? "")}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">
            {String(r[secondary] ?? "")}
          </span>
          <ResultBadge result={(r.result as TestResultStatus) ?? "pending"} />
        </li>
      ))}
    </ul>
  );
}

function TestRecordsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [tag, setTag] = useState("");
  const [date, setDate] = useState(today());
  const [toolTag, setToolTag] = useState("none");
  const [boltRef, setBoltRef] = useState("");
  const [targetTorque, setTargetTorque] = useState("");
  const [cableType, setCableType] = useState<string>(CABLE_TEST_TYPES[0]);
  const [relayType, setRelayType] = useState<string>(RELAY_TEST_TYPES[0]);
  const [trafoType, setTrafoType] = useState<string>(TRANSFORMER_TEST_TYPES[0]);
  const [calTag, setCalTag] = useState("");
  const [calName, setCalName] = useState("");
  const [calDate, setCalDate] = useState(today());
  const [calDue, setCalDue] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getQualityAccess);
  const access = useQuery({ queryKey: ["quality-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWriteRecords ?? false;

  const listFn = useServerFn(listTestRecords);
  const key = ["test-records", activeProject] as const;
  const records = useQuery({
    queryKey: key,
    queryFn: () =>
      listFn({ data: { projectId: activeProject } }) as Promise<Record<string, Row[]>>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const calFn = useServerFn(listCalibrations);
  const calibrations = useQuery({
    queryKey: ["calibrations"],
    queryFn: () => calFn() as Promise<CalRow[]>,
  });
  const selectedCal = useMemo(
    () => (calibrations.data ?? []).find((c) => c.instrument_tag === toolTag) ?? null,
    [calibrations.data, toolTag],
  );

  const mutate = <T,>(fn: (v: T) => Promise<unknown>, message: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        toast.success(message);
        setTag("");
        invalidate();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const weldFn = useServerFn(createWeldingRecord);
  const addWeld = mutate(
    () =>
      weldFn({ data: { projectId: activeProject, welderName: tag.trim(), weldDate: date } }),
    "Weld record saved",
  );

  const torqueFn = useServerFn(createTorqueRecord);
  const addTorque = mutate(
    () =>
      torqueFn({
        data: {
          projectId: activeProject,
          equipmentTag: tag.trim(),
          boltRef: boltRef.trim(),
          targetTorqueNm: Number(targetTorque || 0),
          toolTag: toolTag === "none" ? null : toolTag,
          torqueDate: date,
        },
      }),
    "Torque record saved",
  );

  const cableFn = useServerFn(createCableTest);
  const addCable = mutate(
    () =>
      cableFn({
        data: {
          projectId: activeProject,
          cableTag: tag.trim(),
          testType: cableType as never,
          values: {},
          testDate: date,
        },
      }),
    "Cable test saved",
  );

  const thermoFn = useServerFn(createThermographicInspection);
  const addThermo = mutate(
    () =>
      thermoFn({
        data: { projectId: activeProject, equipmentTag: tag.trim(), inspectionDate: date },
      }),
    "Thermographic inspection saved",
  );

  const relayFn = useServerFn(createRelayTest);
  const addRelay = mutate(
    () =>
      relayFn({
        data: {
          projectId: activeProject,
          relayTag: tag.trim(),
          testType: relayType as never,
          settings: {},
          testDate: date,
        },
      }),
    "Relay test saved",
  );

  const trafoFn = useServerFn(createTransformerTest);
  const addTrafo = mutate(
    () =>
      trafoFn({
        data: {
          projectId: activeProject,
          transformerTag: tag.trim(),
          testType: trafoType as never,
          values: {},
          testDate: date,
        },
      }),
    "Transformer test saved",
  );

  const newCalFn = useServerFn(createCalibration);
  const addCal = useMutation({
    mutationFn: () =>
      newCalFn({
        data: {
          instrumentTag: calTag.trim(),
          instrument: calName.trim() || calTag.trim(),
          calDate,
          nextDue: calDue || null,
          result: "pass",
        },
      }),
    onSuccess: () => {
      toast.success("Calibration recorded");
      setCalTag("");
      setCalName("");
      setCalDue("");
      void qc.invalidateQueries({ queryKey: ["calibrations"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tagField = (label: string, placeholder: string) => (
    <div className="space-y-1">
      <Label htmlFor="record-tag">{label}</Label>
      <Input
        id="record-tag"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const dateField = (
    <div className="space-y-1">
      <Label htmlFor="record-date">Date</Label>
      <Input
        id="record-date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Test records"
        description="Discipline test evidence captured on site with traceable, calibrated instruments."
      />
      <ProjectSelect
        projects={projects.data ?? []}
        value={activeProject}
        onChange={setProjectId}
        loading={projects.isLoading}
      />

      <Tabs defaultValue={TEST_RECORD_TABS[0]}>
        <TabsList className="flex-wrap">
          {TEST_RECORD_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TEST_RECORD_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
          <TabsTrigger value="calibration">Calibration</TabsTrigger>
        </TabsList>

        <TabsContent value="welding">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Welding records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                  {tagField("Welder", "A. Haddad")}
                  {dateField}
                  <Button onClick={() => addWeld.mutate(undefined as never)} disabled={!tag.trim()}>
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.welding?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No welding records"
              >
                <RowList
                  rows={records.data?.welding ?? []}
                  primary="weld_number"
                  secondary="welder_name"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="torque">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Torque records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
                    {tagField("Equipment tag", "TRK-A-012")}
                    <div className="space-y-1">
                      <Label htmlFor="bolt-ref">Bolt ref</Label>
                      <Input
                        id="bolt-ref"
                        value={boltRef}
                        onChange={(e) => setBoltRef(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="target-torque">Target (N·m)</Label>
                      <Input
                        id="target-torque"
                        type="number"
                        value={targetTorque}
                        onChange={(e) => setTargetTorque(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tool-tag">Tool</Label>
                      <Select value={toolTag} onValueChange={setToolTag}>
                        <SelectTrigger id="tool-tag">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {(calibrations.data ?? []).map((c) => (
                            <SelectItem key={c.instrument_tag} value={c.instrument_tag}>
                              {c.instrument_tag}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => addTorque.mutate(undefined as never)}
                      disabled={!tag.trim() || !boltRef.trim()}
                    >
                      <Plus className="mr-1 size-4" /> Save
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {dateField}
                    {toolTag !== "none" ? (
                      <CalibrationChip nextDue={selectedCal?.next_due} referenceDate={date} />
                    ) : null}
                  </div>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.torque?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No torque records"
              >
                <RowList
                  rows={records.data?.torque ?? []}
                  primary="equipment_tag"
                  secondary="bolt_ref"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cable">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cable tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                  {tagField("Cable tag", "MV-C-01")}
                  <div className="space-y-1">
                    <Label htmlFor="cable-type">Test type</Label>
                    <Select value={cableType} onValueChange={setCableType}>
                      <SelectTrigger id="cable-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CABLE_TEST_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {dateField}
                  <Button
                    onClick={() => addCable.mutate(undefined as never)}
                    disabled={!tag.trim()}
                  >
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.cable?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No cable tests"
              >
                <RowList
                  rows={records.data?.cable ?? []}
                  primary="cable_tag"
                  secondary="test_type"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="thermographic">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thermographic inspections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                  {tagField("Equipment tag", "SWG-01")}
                  {dateField}
                  <Button
                    onClick={() => addThermo.mutate(undefined as never)}
                    disabled={!tag.trim()}
                  >
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.thermographic?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No thermographic inspections"
              >
                <RowList
                  rows={records.data?.thermographic ?? []}
                  primary="equipment_tag"
                  secondary="finding"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="relay">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Relay testing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                  {tagField("Relay tag", "R-87T-01")}
                  <div className="space-y-1">
                    <Label htmlFor="relay-type">Test type</Label>
                    <Select value={relayType} onValueChange={setRelayType}>
                      <SelectTrigger id="relay-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RELAY_TEST_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {dateField}
                  <Button
                    onClick={() => addRelay.mutate(undefined as never)}
                    disabled={!tag.trim()}
                  >
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.relay?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No relay tests"
              >
                <RowList
                  rows={records.data?.relay ?? []}
                  primary="relay_tag"
                  secondary="test_type"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transformer">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transformer tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                  {tagField("Transformer tag", "TX-01")}
                  <div className="space-y-1">
                    <Label htmlFor="trafo-type">Test type</Label>
                    <Select value={trafoType} onValueChange={setTrafoType}>
                      <SelectTrigger id="trafo-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSFORMER_TEST_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {dateField}
                  <Button
                    onClick={() => addTrafo.mutate(undefined as never)}
                    disabled={!tag.trim()}
                  >
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={records.isLoading}
                isError={records.isError}
                onRetry={() => void records.refetch()}
                isEmpty={(records.data?.transformer?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No transformer tests"
              >
                <RowList
                  rows={records.data?.transformer ?? []}
                  primary="transformer_tag"
                  secondary="test_type"
                />
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calibration">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calibration register</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label htmlFor="cal-tag">Instrument tag</Label>
                    <Input
                      id="cal-tag"
                      value={calTag}
                      onChange={(e) => setCalTag(e.target.value)}
                      placeholder="TW-014"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-name">Instrument</Label>
                    <Input
                      id="cal-name"
                      value={calName}
                      onChange={(e) => setCalName(e.target.value)}
                      placeholder="Torque wrench 300 N·m"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-date">Calibrated</Label>
                    <Input
                      id="cal-date"
                      type="date"
                      value={calDate}
                      onChange={(e) => setCalDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-due">Next due</Label>
                    <Input
                      id="cal-due"
                      type="date"
                      value={calDue}
                      onChange={(e) => setCalDue(e.target.value)}
                    />
                  </div>
                  <Button onClick={() => addCal.mutate()} disabled={!calTag.trim()}>
                    <Plus className="mr-1 size-4" /> Save
                  </Button>
                </div>
              ) : null}
              <PanelState
                isLoading={calibrations.isLoading}
                isError={calibrations.isError}
                onRetry={() => void calibrations.refetch()}
                isEmpty={(calibrations.data?.length ?? 0) === 0}
                emptyIcon={Gauge}
                emptyTitle="No calibrated instruments"
                emptyDescription="Torque tools must trace to a valid calibration record."
              >
                <ul className="divide-y divide-border">
                  {(calibrations.data ?? []).map((c) => (
                    <li
                      key={`${c.instrument_tag}-${c.cal_date}`}
                      className="flex flex-wrap items-center gap-3 py-3"
                    >
                      <span className="font-medium text-foreground">{c.instrument_tag}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{c.instrument}</span>
                      <Badge variant="outline">Calibrated {c.cal_date}</Badge>
                      <CalibrationChip nextDue={c.next_due} referenceDate={today()} />
                    </li>
                  ))}
                </ul>
              </PanelState>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
