// P-185 — Emergency response register (drills and actual events).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Siren } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister } from "@/components/hse/hse-ext-bits";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import { createEmergencyResponse, listEmergencyResponses } from "@/lib/hse-ext.functions";
import { EMERGENCY_EVENT_TYPES, EMERGENCY_KINDS, hseLabel } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/emergency")({
  head: () => ({
    meta: [
      { title: "Emergency response — GridMind EPC" },
      {
        name: "description",
        content: "Emergency drills and actual events with response times and lessons learned.",
      },
      { property: "og:title", content: "Emergency response — GridMind EPC" },
      {
        property: "og:description",
        content: "Track drill performance and real incident response across the site.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmergencyPage,
});

type EmRow = {
  id: string;
  kind: string;
  event_type: string;
  occurred_at: string;
  response_time_minutes: number | null;
  casualties: number;
  lessons_learned: string | null;
};

function EmergencyPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<(typeof EMERGENCY_KINDS)[number]>("drill");
  const [eventType, setEventType] = useState<(typeof EMERGENCY_EVENT_TYPES)[number]>("medical");
  const [occurredAt, setOccurredAt] = useState("");
  const [responseTime, setResponseTime] = useState("");
  const [casualties, setCasualties] = useState("0");
  const [lessons, setLessons] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const listFn = useServerFn(listEmergencyResponses);
  const key = ["hse", "emergency", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<EmRow[]>,
    enabled: Boolean(activeProject),
  });

  const createFn = useServerFn(createEmergencyResponse);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          kind,
          eventType,
          occurredAt: new Date(occurredAt).toISOString(),
          responseTimeMinutes: responseTime ? Number(responseTime) : null,
          casualties: Number(casualties) || 0,
          lessonsLearned: lessons.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Logged");
      setOccurredAt("");
      setResponseTime("");
      setLessons("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) => [r.kind, r.event_type].some((v) => v.toLowerCase().includes(term)));
  }, [list.data, search]);

  const drills = rows.filter((r) => r.kind === "drill" && r.response_time_minutes != null);
  const avgDrill = drills.length
    ? Math.round(
        (drills.reduce((a, b) => a + Number(b.response_time_minutes), 0) / drills.length) * 10,
      ) / 10
    : null;

  return (
    <div className="page-shell">
      <PageHeader
        title="Emergency response"
        description="Drills and real events, timed and reviewed."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Log an event</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMERGENCY_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {hseLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Event type</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as typeof eventType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMERGENCY_EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {hseLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-when">Occurred at</Label>
              <Input
                id="em-when"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-rt">Response time (min)</Label>
              <Input
                id="em-rt"
                type="number"
                min={0}
                value={responseTime}
                onChange={(e) => setResponseTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-cas">Casualties</Label>
              <Input
                id="em-cas"
                type="number"
                min={0}
                value={casualties}
                onChange={(e) => setCasualties(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-lessons">Lessons learned</Label>
            <Textarea
              id="em-lessons"
              rows={3}
              value={lessons}
              onChange={(e) => setLessons(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={!activeProject || !occurredAt || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={14} aria-hidden /> Log
          </Button>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Average drill response: {avgDrill == null ? "—" : `${avgDrill} min`}
      </p>

      <HseRegister
        title="Register"
        icon={Siren}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="emergency-response.csv"
            headers={["Kind", "Event", "Occurred", "Response (min)", "Casualties"]}
            rows={rows.map((r) => [
              r.kind,
              r.event_type,
              r.occurred_at,
              r.response_time_minutes ?? "",
              r.casualties,
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No emergency records"
        emptyDescription="Log the first drill or event for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Occurred</TableHead>
              <TableHead>Response</TableHead>
              <TableHead>Casualties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant={r.kind === "actual" ? "destructive" : "secondary"}>
                    {hseLabel(r.kind)}
                  </Badge>
                </TableCell>
                <TableCell>{hseLabel(r.event_type)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(r.occurred_at).toLocaleString()}
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.response_time_minutes == null ? "—" : `${r.response_time_minutes} min`}
                </TableCell>
                <TableCell className="tabular-nums">{r.casualties}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
