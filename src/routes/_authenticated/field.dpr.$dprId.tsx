// P-086 — DPR detail: 4-step wizard, submit, approve.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Package,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PhotoGuardDialog } from "@/components/dpr/photo-guard-dialog";
import { StepManpower } from "@/components/dpr/step-manpower";
import { StepPhotos } from "@/components/dpr/step-photos";
import { StepQuantities } from "@/components/dpr/step-quantities";
import { StepWeather } from "@/components/dpr/step-weather";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { dprDetailQueryOptions, errorMessage } from "@/lib/dpr-query";
import { approveDpr, submitDpr } from "@/lib/dpr.functions";

const searchSchema = z.object({
  step: z.coerce.number().int().min(1).max(4).default(1),
});

export const Route = createFileRoute("/_authenticated/field/dpr/$dprId")({
  validateSearch: (raw) => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Daily report — GridMind EPC" },
      {
        name: "description",
        content: "Capture site progress, weather, and installed quantities.",
      },
      { property: "og:title", content: "Daily report — GridMind EPC" },
      {
        property: "og:description",
        content: "Field DPR capture and submission.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(dprDetailQueryOptions(params.dprId)),
  component: DprDetailPage,
});

const STEPS = [
  { id: 1, label: "Manpower", icon: Users },
  { id: 2, label: "Weather", icon: CloudRain },
  { id: 3, label: "Quantities", icon: Package },
  { id: 4, label: "Photos", icon: Camera },
] as const;

function DprDetailPage() {
  const { dprId } = Route.useParams();
  const { step } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery(dprDetailQueryOptions(dprId));
  const submit = useServerFn(submitDpr);
  const approve = useServerFn(approveDpr);

  const [guardOpen, setGuardOpen] = useState(false);
  const [ack, setAck] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: dprDetailQueryOptions(dprId).queryKey });

  const submitMut = useMutation({
    mutationFn: () => submit({ data: { id: dprId, acknowledgeNoPhotos: ack } }),
    onSuccess: () => {
      toast.success("DPR submitted");
      setGuardOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const approveMut = useMutation({
    mutationFn: () => approve({ data: { id: dprId } }),
    onSuccess: () => {
      toast.success("DPR approved");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span className="font-medium">Failed to load DPR</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage(query.error)}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const detail = query.data;
  const { header, manpower, weather, photos, observations, permissions, project } = detail;
  const readOnly = !permissions.canEdit;
  const isSubmitted = header.status !== "draft";

  const goStep = (n: number) =>
    navigate({
      to: "/field/dpr/$dprId",
      params: { dprId },
      search: { step: Math.min(4, Math.max(1, n)) },
    });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-28">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to="/field/dpr">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> All reports
        </Link>
      </Button>

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0 space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily report</div>
          <h1 className="truncate font-display text-xl font-semibold text-foreground sm:text-2xl">
            {project?.name ?? header.project_id}
          </h1>
          <p className="text-sm text-muted-foreground">
            {header.report_date} · {header.shift} shift
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant={
              header.status === "approved"
                ? "default"
                : header.status === "submitted"
                  ? "secondary"
                  : "outline"
            }
            className="capitalize"
          >
            {header.status}
          </Badge>
          {photos.length === 0 && isSubmitted && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning-foreground">
              no photos
            </span>
          )}
        </div>
      </header>

      <Card>
        <CardContent className="p-2">
          <nav className="grid grid-cols-4 gap-1">
            {STEPS.map((s) => {
              const active = s.id === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goStep(s.id)}
                  className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <s.icon className="h-4 w-4" aria-hidden />
                  {s.label}
                </button>
              );
            })}
          </nav>
        </CardContent>
      </Card>

      {step === 1 && <StepManpower dprId={dprId} rows={manpower} readOnly={readOnly} />}
      {step === 2 && <StepWeather header={header} delays={weather} readOnly={readOnly} />}
      {step === 3 && <StepQuantities header={header} readOnly={readOnly} />}
      {step === 4 && (
        <StepPhotos
          header={header}
          photos={photos}
          observations={observations}
          readOnly={readOnly}
        />
      )}

      {/* sticky bottom action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 p-3">
          <Button
            type="button"
            variant="outline"
            className="h-12"
            disabled={step === 1}
            onClick={() => goStep(step - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            Prev
          </Button>
          {step < 4 ? (
            <Button type="button" className="h-12 flex-1" onClick={() => goStep(step + 1)}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          ) : header.status === "draft" ? (
            <Button
              type="button"
              className="h-12 flex-1"
              disabled={manpower.length === 0}
              onClick={() => {
                setAck(false);
                setGuardOpen(true);
              }}
            >
              <Send className="mr-2 h-4 w-4" aria-hidden />
              Submit
            </Button>
          ) : permissions.canApprove ? (
            <Button
              type="button"
              className="h-12 flex-1"
              disabled={approveMut.isPending}
              onClick={() => approveMut.mutate()}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
              Approve
            </Button>
          ) : (
            <div className="flex-1 text-center text-xs text-muted-foreground">
              {header.status === "submitted" ? "Awaiting admin approval" : "Approved"}
            </div>
          )}
        </div>
      </div>

      <PhotoGuardDialog
        open={guardOpen}
        onOpenChange={setGuardOpen}
        photoCount={photos.length}
        acknowledge={ack}
        onAcknowledgeChange={setAck}
        submitting={submitMut.isPending}
        onConfirm={() => submitMut.mutate()}
      />
    </div>
  );
}
