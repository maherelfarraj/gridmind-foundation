// P-086 — Create a new DPR (project + date + shift).
import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
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
import { PageHeader } from "@/components/ui/page-header";
import { dprProjectsQueryOptions, errorMessage } from "@/lib/dpr-query";
import { upsertDprHeader } from "@/lib/dpr.functions";
import { SHIFTS, type Shift } from "@/lib/dpr.rules";

export const Route = createFileRoute("/_authenticated/field/dpr/new")({
  head: () => ({
    meta: [
      { title: "New daily report — GridMind EPC" },
      {
        name: "description",
        content: "Start a new daily progress report from the field.",
      },
      { property: "og:title", content: "New daily report — GridMind EPC" },
      {
        property: "og:description",
        content: "Capture site manpower, weather, quantities and photos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewDprPage,
});

function NewDprPage() {
  const navigate = useNavigate();
  const projectsQuery = useQuery(dprProjectsQueryOptions());
  const upsert = useServerFn(upsertDprHeader);

  const today = new Date().toISOString().slice(0, 10);
  const [projectId, setProjectId] = useState<string>("");
  const [reportDate, setReportDate] = useState<string>(today);
  const [shift, setShift] = useState<Shift>("day");
  const [dupError, setDupError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          projectId,
          reportDate,
          shift,
        },
      }),
    onSuccess: (row) => {
      toast.success("Draft created");
      navigate({ to: "/field/dpr/$dprId", params: { dprId: row.id }, search: { step: 1 } });
    },
    onError: (e) => {
      const msg = errorMessage(e);
      if (/already exists/i.test(msg)) {
        setDupError(msg);
      } else {
        toast.error(msg);
      }
    },
  });

  return (
    <div className="page-shell pb-24">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to="/field/dpr">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back
        </Link>
      </Button>
      <PageHeader
        title="New daily report"
        description="Start a draft for a project, date and shift."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Report details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="np-project" className="h-11">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-date">Date</Label>
              <Input
                id="np-date"
                type="date"
                className="h-11"
                value={reportDate}
                onChange={(e) => {
                  setDupError(null);
                  setReportDate(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-shift">Shift</Label>
              <Select
                value={shift}
                onValueChange={(v) => {
                  setDupError(null);
                  setShift(v as Shift);
                }}
              >
                <SelectTrigger id="np-shift" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {dupError && <p className="text-sm text-destructive">{dupError}</p>}
          <Button
            type="button"
            className="h-11"
            disabled={!projectId || !reportDate || create.isPending}
            onClick={() => {
              setDupError(null);
              create.mutate();
            }}
          >
            Create draft
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
