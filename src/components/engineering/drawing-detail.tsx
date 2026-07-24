// P-053 — Drawing detail (header + revisions/markups/sign-off tabs).
import { Suspense, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDrawing,
  getMyDrawingRoles,
  type RevisionRow,
} from "@/lib/drawings.functions";
import {
  drawingQueryOptions,
  drawingRolesQueryOptions,
} from "@/lib/drawings-query";
import { statusBadgeClass } from "./drawing-register-table";
import { RevisionTimeline } from "./revision-timeline";
import { UploadRevisionDialog } from "./upload-revision-dialog";
import { SignoffCard } from "./signoff-card";
import { MarkupViewer } from "./markup-viewer";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  IFD: "IFD",
  IFC: "IFC",
  as_built: "As-built",
  superseded: "Superseded",
};

const DISCIPLINE_LABEL: Record<string, string> = {
  civil: "Civil",
  structural: "Structural",
  electrical: "Electrical",
  mechanical: "Mechanical",
  scada_controls: "SCADA/Controls",
  survey: "Survey",
  general: "General",
};

interface Props {
  drawingId: string;
  projectId: string;
}

export function DrawingDetail({ drawingId, projectId }: Props) {
  const getFn = useServerFn(getDrawing);
  const rolesFn = useServerFn(getMyDrawingRoles);
  const { data } = useSuspenseQuery(drawingQueryOptions(getFn, drawingId));
  const { data: roles } = useSuspenseQuery(drawingRolesQueryOptions(rolesFn, projectId));
  const { drawing, revisions } = data as any as {
    drawing: {
      id: string;
      drawing_number: string;
      title: string;
      discipline: string;
      current_status: string;
      current_revision_id: string | null;
      locked: boolean;
    };
    revisions: RevisionRow[];
  };

  const [selectedRevId, setSelectedRevId] = useState<string | null>(
    drawing.current_revision_id ?? revisions[revisions.length - 1]?.id ?? null,
  );
  const selectedRev = revisions.find((r) => r.id === selectedRevId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="sm">
          <Link
            to="/projects/$projectId/engineering/drawings"
            params={{ projectId }}
          >
            <ChevronLeft size={14} />
            Back to register
          </Link>
        </Button>
      </div>
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {drawing.drawing_number}
              </span>
              <Badge variant="outline">
                {DISCIPLINE_LABEL[drawing.discipline] ?? drawing.discipline}
              </Badge>
              <Badge className={statusBadgeClass(drawing.current_status as any)}>
                {STATUS_LABEL[drawing.current_status] ?? drawing.current_status}
              </Badge>
              {drawing.locked && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  aria-label="Locked"
                >
                  <Lock size={12} />
                  Locked
                </span>
              )}
            </span>
            <h1 className="font-display text-xl font-semibold text-foreground">
              {drawing.title}
            </h1>
          </div>
          {roles.canWrite && (
            <UploadRevisionDialog
              drawingId={drawing.id}
              projectId={projectId}
              disabled={drawing.locked}
            />
          )}
        </div>
      </Card>

      <Tabs defaultValue="revisions" className="flex flex-col gap-3">
        <TabsList>
          <TabsTrigger value="revisions">Revisions</TabsTrigger>
          <TabsTrigger value="markups">Markups</TabsTrigger>
          <TabsTrigger value="signoff">Sign-off</TabsTrigger>
        </TabsList>
        <TabsContent value="revisions">
          <RevisionTimeline
            drawingId={drawing.id}
            projectId={projectId}
            revisions={revisions}
            currentRevisionId={drawing.current_revision_id}
          />
        </TabsContent>
        <TabsContent value="markups">
          {revisions.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Upload a revision to start collecting markups.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Revision:
                </span>
                {revisions.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={r.id === selectedRevId ? "default" : "outline"}
                    onClick={() => setSelectedRevId(r.id)}
                  >
                    Rev {r.revision_code}
                  </Button>
                ))}
              </div>
              {selectedRev && (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <MarkupViewer revision={selectedRev} projectId={projectId} />
                </Suspense>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="signoff">
          <SignoffCard drawingId={drawing.id} projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function DrawingDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
