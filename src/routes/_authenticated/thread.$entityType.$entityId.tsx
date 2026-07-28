// P-188 — Digital thread viewer: graph + impact assessments for any entity.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { AlertTriangle, Check, Network, X } from "lucide-react";
import { toast } from "sonner";

import { ThreadGraph } from "@/components/thread/thread-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getEntityThread, updateImpactStatus } from "@/lib/digital-thread/thread.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/thread/$entityType/$entityId")({
  validateSearch: (search: Record<string, unknown>) => ({
    depth: Math.min(4, Math.max(1, Number(search.depth ?? 2) || 2)),
  }),
  head: () => ({
    meta: [
      { title: "Digital thread · GridMind EPC" },
      {
        name: "description",
        content:
          "Trace any record across the EPC lifecycle: linked entities, change events and open impact assessments.",
      },
      { property: "og:title", content: "Digital thread · GridMind EPC" },
      {
        property: "og:description",
        content: "Graph of linked EPC records with impact assessments and management of change.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ThreadPage,
});

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

const STATUS_CLASS: Record<string, string> = {
  open: "bg-warning/15 text-warning",
  acknowledged: "bg-primary/10 text-primary",
  resolved: "bg-success/15 text-success",
  dismissed: "bg-muted text-muted-foreground",
};

function ThreadPage() {
  const { t } = useI18n();
  const { entityType, entityId } = Route.useParams();
  const { depth } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchThread = useServerFn(getEntityThread);
  const setStatus = useServerFn(updateImpactStatus);

  const queryKey = ["thread", entityType, entityId, depth];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchThread({ data: { entityType, entityId, depth } }),
  });

  const mutation = useMutation({
    mutationFn: (vars: { id: string; status: "acknowledged" | "resolved" | "dismissed" }) =>
      setStatus({ data: vars }),
    onSuccess: async (_res, vars) => {
      toast.success(t("adminMod.digitalThread.impactUpdated", { status: t(`adminMod.digitalThread.status.${vars.status}`) }));
      await qc.invalidateQueries({ queryKey: ["thread"] });
    },
    onError: (err) => toast.error(String((err as Error)?.message ?? t("adminMod.digitalThread.updateFailed"))),
  });

  const impacts = data?.impacts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("adminMod.digitalThread.title")}
        description={`${entityType.replaceAll("_", " ")} · ${entityId.slice(0, 8)}…`}
        actions={
          <Select
            value={String(depth)}
            onValueChange={(v) =>
              navigate({ to: ".", search: { depth: Number(v) }, replace: true })
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("adminMod.digitalThread.depth", { value: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4" /> {t("adminMod.digitalThread.linkedEntities")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (data?.graph.nodes.length ?? 0) <= 1 ? (
            <EmptyState
              icon={Network}
              title={t("adminMod.digitalThread.noLinksYet")}
              description={t("adminMod.digitalThread.noLinksYetDesc")}
            />
          ) : (
            <ThreadGraph graph={data!.graph} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4" /> {t("adminMod.digitalThread.impactAssessments")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : impacts.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title={t("adminMod.digitalThread.noImpactAssessments")}
              description={t("adminMod.digitalThread.noImpactAssessmentsDesc")}
            />
          ) : (
            impacts.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.title}</span>
                  <Badge className={SEVERITY_CLASS[a.severity] ?? SEVERITY_CLASS.low}>
                    {t(`adminMod.digitalThread.severity.${a.severity}`, { defaultValue: a.severity })}
                  </Badge>
                  <Badge className={STATUS_CLASS[a.status] ?? STATUS_CLASS.open}>
                    {t(`adminMod.digitalThread.status.${a.status}`, { defaultValue: a.status })}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(a.created_at), "dd MMM yyyy HH:mm")}
                  </span>
                </div>
                {a.summary ? (
                  <p className="mt-1 text-sm text-muted-foreground">{a.summary}</p>
                ) : null}
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {(a.impacts ?? []).map((i, idx) => {
                    const rec = i as Record<string, string | null>;
                    return (
                      <li
                        key={`${a.id}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs"
                      >
                        <span className="text-foreground">
                          {String(rec.area ?? "").replaceAll("_", " ")}
                        </span>
                        <span className="text-muted-foreground">
                          {String(rec.action ?? "").replaceAll("_", " ")}
                          {rec.entity_id ? "" : ` · ${t("adminMod.digitalThread.unresolved")}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("adminMod.digitalThread.recommendationsOnly")}
                </p>
                {a.status === "open" || a.status === "acknowledged" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.status === "open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: a.id, status: "acknowledged" })}
                      >
                        <Check className="mr-1 size-3" /> {t("adminMod.digitalThread.acknowledge")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: a.id, status: "resolved" })}
                    >
                      {t("adminMod.digitalThread.resolve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: a.id, status: "dismissed" })}
                    >
                      <X className="mr-1 size-3" /> {t("adminMod.digitalThread.dismiss")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
