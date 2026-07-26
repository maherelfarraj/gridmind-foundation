// P-169 — Electrical-analysis study list.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FlaskConical, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EaValidationNotice } from "@/components/engineering/ea-study-workspace";
import { isCalculatorStudyType } from "@/lib/electrical";
import {
  EA_STUDY_GROUP_LABELS,
  EA_STUDY_LIST,
  EA_STUDY_SPECS,
  EA_STUDY_TYPES,
  type EaStudyType,
} from "@/lib/ea/study-types";
import { listEaStudies } from "@/lib/ea-studies.functions";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/studies/")({
  head: () => ({
    meta: [
      { title: "Electrical studies — GridMind EPC" },
      {
        name: "description",
        content:
          "Load flow, short-circuit, sizing and grid-code studies for the project, with review status, revisions and branded engineering reports.",
      },
      { property: "og:title", content: "Electrical studies — GridMind EPC" },
      {
        property: "og:description",
        content: "Electrical analysis workspace for renewable EPC projects.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudyListPage,
});

const GROUP_ORDER = ["power_system", "protection", "auxiliary", "compliance"] as const;

function StudyListPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listEaStudies);
  const [studyType, setStudyType] = useState<"all" | EaStudyType>("all");
  const [status, setStatus] = useState<"all" | "draft" | "under_review" | "approved">("all");
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = useQuery({
    queryKey: ["ea-studies", projectId, studyType, status],
    queryFn: () =>
      listFn({
        data: {
          projectId,
          studyType: studyType === "all" ? null : studyType,
          status: status === "all" ? null : status,
        },
      }),
  });

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: EA_STUDY_GROUP_LABELS[group],
        specs: EA_STUDY_LIST.filter((s) => s.group === group),
      })),
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Electrical studies"
        description="Every calculation is a numbered, revisioned record with its own review trail."
        actions={
          <Button onClick={() => setPickerOpen(true)}>
            <Plus className="mr-1 size-4" aria-hidden /> New study
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <Select value={studyType} onValueChange={(v) => setStudyType(v as typeof studyType)}>
            <SelectTrigger className="h-9 w-56" aria-label="Filter by study type">
              <SelectValue placeholder="All study types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All study types</SelectItem>
              {EA_STUDY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {EA_STUDY_SPECS[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="under_review">Under review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
          <Link
            to="/projects/$projectId/engineering/grid-code"
            params={{ projectId }}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Grid-code checklist
          </Link>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Studies could not be loaded"
          description={query.error instanceof Error ? query.error.message : "Unexpected error"}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (query.data?.studies ?? []).length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No studies yet — run your first calculation"
          description="Pick a study type to open the workspace; results, warnings and method text are stored with the record."
          action={<Button onClick={() => setPickerOpen(true)}>New study</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Study</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rev</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data?.studies ?? []).map((study) => (
                <TableRow key={study.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/projects/$projectId/engineering/studies/$studyId"
                      params={{ projectId, studyId: study.id }}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {study.study_number}
                    </Link>
                  </TableCell>
                  <TableCell>{study.title}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status="info"
                      tone="neutral"
                      label={EA_STUDY_SPECS[study.study_type]?.label ?? study.study_type}
                    />
                  </TableCell>
                  <TableCell>{study.revision}</TableCell>
                  <TableCell>
                    <StatusBadge status={study.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(study.updated_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EaValidationNotice />

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New study</DialogTitle>
            <DialogDescription>
              Choose the calculation to run. Types without a wired calculator open through the
              protection and grid-code worksheets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {grouped.map((group) => (
              <section key={group.group} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.specs.map((spec) =>
                    isCalculatorStudyType(spec.type) ? (
                      <Link
                        key={spec.type}
                        to="/projects/$projectId/engineering/studies/$studyType/new"
                        params={{ projectId, studyType: spec.type }}
                        onClick={() => setPickerOpen(false)}
                        className="rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary"
                      >
                        <p className="text-sm font-medium text-foreground">{spec.label}</p>
                        <p className="text-xs text-muted-foreground">{spec.summary}</p>
                      </Link>
                    ) : (
                      <div
                        key={spec.type}
                        className="rounded-md border border-dashed border-border bg-card/50 p-3"
                      >
                        <p className="text-sm font-medium text-muted-foreground">{spec.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {spec.type === "grid_code_checklist"
                            ? "Tracked in the grid-code checklist view."
                            : "Prepared through the protection worksheets."}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
