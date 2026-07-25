// P-088 — HSE incident detail.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Shield, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  errorMessage,
  incidentDetailQueryOptions,
} from "@/lib/hse-query";
import { closeIncident, updateIncident } from "@/lib/hse.functions";
import type { CorrectiveAction } from "@/lib/hse.rules";
import { IncidentTimingBadge } from "@/components/hse/incident-timing-badge";

export const Route = createFileRoute("/_authenticated/hse/incidents/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Incident ${params.id.slice(0, 8)} — GridMind EPC` },
      { name: "description", content: "HSE incident detail." },
      { property: "og:title", content: "HSE incident" },
      { property: "og:description", content: "Incident detail and corrective actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IncidentDetailPage,
});

function IncidentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailQuery = useQuery(incidentDetailQueryOptions(id));
  const data = detailQuery.data;
  const [newAction, setNewAction] = useState("");

  const closeMut = useMutation({
    mutationFn: () => closeIncident({ data: { id } as any }),
    onSuccess: async () => {
      toast.success("Incident closed");
      await qc.invalidateQueries({ queryKey: ["hse"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setActionsMut = useMutation({
    mutationFn: (actions: CorrectiveAction[]) =>
      updateIncident({ data: { id, correctiveActions: actions } as any }),
    onSuccess: async () => {
      setNewAction("");
      await qc.invalidateQueries({ queryKey: ["hse"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4">
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (detailQuery.isError || !data) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4">
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {errorMessage(detailQuery.error) || "Not found"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const inc = data.incident;
  const canEdit = data.permissions.canEdit;
  const actions = (inc.corrective_actions ?? []) as CorrectiveAction[];

  const addAction = () => {
    if (!newAction.trim()) return;
    setActionsMut.mutate([
      ...actions,
      { action: newAction.trim(), owner: null, due_date: null },
    ]);
  };
  const removeAction = (i: number) => {
    setActionsMut.mutate(actions.filter((_, idx) => idx !== i));
  };
  const markDone = (i: number) => {
    const clone = actions.slice();
    clone[i] = { ...clone[i], done_at: new Date().toISOString() };
    setActionsMut.mutate(clone);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-2">
        <Link
          to="/hse/incidents"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to incidents
        </Link>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Shield size={14} aria-hidden /> HSE
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {inc.incident_number}
          </h1>
          <Badge variant="secondary" className="capitalize">
            {inc.incident_type.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {inc.severity}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {inc.status}
          </Badge>
          {inc.osha_recordable ? (
            <Badge className="bg-destructive/10 text-destructive">OSHA</Badge>
          ) : null}
          <IncidentTimingBadge
            occurredAt={inc.occurred_at}
            reportedAt={inc.reported_at}
          />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Project" value={inc.project_name ?? "—"} />
          <Field label="Occurred" value={new Date(inc.occurred_at).toLocaleString()} />
          <Field label="Reported" value={new Date(inc.reported_at).toLocaleString()} />
          <Field label="Location" value={inc.location ?? "—"} />
          <Field label="Days away" value={String(inc.days_away_from_work)} />
          <Field
            label="Restricted duty"
            value={inc.restricted_duty ? "Yes" : "No"}
          />
          <Field
            label="Medical treatment"
            value={inc.medical_treatment ? "Yes" : "No"}
          />
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Description
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {inc.description}
            </p>
          </div>
          {inc.persons_involved ? (
            <div className="md:col-span-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Persons involved
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {inc.persons_involved}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Corrective actions</CardTitle>
          {inc.status !== "closed" && canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => closeMut.mutate()}
              disabled={closeMut.isPending}
            >
              <CheckCircle2 size={14} aria-hidden /> Close incident
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {actions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No corrective actions logged yet.
            </div>
          ) : (
            actions.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <div className="flex-1">
                  <div className="text-sm text-foreground">{a.action}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.owner ? `${a.owner} · ` : ""}
                    {a.due_date ?? "no due date"}
                    {a.done_at ? ` · done ${new Date(a.done_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {canEdit && !a.done_at ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => markDone(i)}
                    disabled={setActionsMut.isPending}
                  >
                    Mark done
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAction(i)}
                    disabled={setActionsMut.isPending}
                    aria-label="Remove"
                  >
                    <X size={14} aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))
          )}
          {canEdit ? (
            <div className="flex gap-2">
              <Input
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                placeholder="Add corrective action…"
              />
              <Button
                type="button"
                onClick={addAction}
                disabled={!newAction.trim() || setActionsMut.isPending}
              >
                Add
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}
