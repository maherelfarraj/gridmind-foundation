// P-114 — Portal project detail with tabs: Overview · Milestones · Photos · Approvals · Tickets.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  ShieldAlert,
  TrendingUp,
  XCircle,
} from "lucide-react";

import {
  decidePortalApproval,
  getPortalFeed,
  getPortalPhotoSignedUrl,
  getPortalApprovals,
  listMyPortalTickets,
  raisePortalTicket,
  type PortalApprovalRow,
  type PortalFeed,
} from "@/lib/portal.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/portal/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project — GridMind Portal" },
      {
        name: "description",
        content: "Curated milestones, photos, approvals, and tickets.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PortalProjectPage,
});

// ---------------------------------------------------------------------------

function PortalProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const feedFn = useServerFn(getPortalFeed);
  const feedQ = useQuery({
    queryKey: ["portal", "feed", projectId],
    queryFn: () => feedFn({ data: { projectId } }),
    retry: false,
  });

  if (feedQ.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (feedQ.error) {
    const msg = (feedQ.error as Error).message || "";
    const denied = /forbidden|expired|revoked|access/i.test(msg);
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 p-10 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <h1 className="font-display text-xl font-semibold text-foreground">
          {denied ? "Access expired or revoked" : "Could not load portal"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {denied
            ? "Your access to this project is no longer active. Contact your project sponsor."
            : "Please retry in a moment."}
        </p>
        <Button variant="outline" onClick={() => navigate({ to: "/portal" })}>
          Back to projects
        </Button>
      </div>
    );
  }

  const feed = feedQ.data as PortalFeed;
  const projectName = feed.project.code
    ? `${feed.project.code} · ${feed.project.name ?? "Project"}`
    : (feed.project.name ?? "Project");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {projectName}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {feed.project.phase ? `Phase: ${feed.project.phase}` : null}
            {feed.project.status ? ` · ${feed.project.status}` : null}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          Updated {formatDistanceToNow(new Date(feed.as_of), { addSuffix: true })}
        </div>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {feed.exposure.milestones ? (
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
          ) : null}
          {feed.exposure.photos ? (
            <TabsTrigger value="photos">Photos</TabsTrigger>
          ) : null}
          {feed.exposure.approvals ? (
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
          ) : null}
          {feed.exposure.tickets ? (
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab feed={feed} />
        </TabsContent>
        {feed.exposure.milestones ? (
          <TabsContent value="milestones" className="mt-4">
            <MilestonesTab feed={feed} />
          </TabsContent>
        ) : null}
        {feed.exposure.photos ? (
          <TabsContent value="photos" className="mt-4">
            <PhotosTab feed={feed} />
          </TabsContent>
        ) : null}
        {feed.exposure.approvals ? (
          <TabsContent value="approvals" className="mt-4">
            <ApprovalsTab projectId={projectId} />
          </TabsContent>
        ) : null}
        {feed.exposure.tickets ? (
          <TabsContent value="tickets" className="mt-4">
            <TicketsTab projectId={projectId} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({ feed }: { feed: PortalFeed }) {
  const kpi = feed.kpis;
  const showKpis = feed.exposure.kpis && kpi;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-medium text-muted-foreground">Project</h2>
        <div className="mt-2 space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Name:</span>{" "}
            <span className="text-foreground">
              {feed.project.name ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Code:</span>{" "}
            <span className="font-mono text-xs">
              {feed.project.code ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Phase:</span>{" "}
            <span className="text-foreground">
              {feed.project.phase ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {showKpis ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> KPIs
            {kpi.as_of_date ? (
              <span className="ml-auto text-[11px] text-muted-foreground">
                as of {format(new Date(kpi.as_of_date), "PP")}
              </span>
            ) : null}
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <KpiTile label="SPI" value={kpi.spi} format="ratio" />
            <KpiTile label="CPI" value={kpi.cpi} format="ratio" />
            <KpiTile label="EV" value={kpi.ev} format="money" />
            <KpiTile label="EAC" value={kpi.eac} format="money" />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          Nothing shared yet.
        </div>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  format: fmt,
}: {
  label: string;
  value: number | null | undefined;
  format: "ratio" | "money";
}) {
  const display =
    value == null
      ? "—"
      : fmt === "ratio"
        ? value.toFixed(2)
        : value.toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          });
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-semibold text-foreground">
        {display}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MilestonesTab({ feed }: { feed: PortalFeed }) {
  const rows = feed.milestones ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <Calendar className="mx-auto mb-2 h-5 w-5" />
        Nothing shared yet.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((m) => {
        const done = m.status === "closed" || m.status === "approved";
        return (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
          >
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <Calendar className="h-4 w-4 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {m.phase}
              </div>
              {m.notes ? (
                <div className="truncate text-xs text-muted-foreground">
                  {m.notes}
                </div>
              ) : null}
            </div>
            <div className="text-right text-xs">
              <div className="text-muted-foreground">
                Planned{" "}
                {m.planned_date ? format(new Date(m.planned_date), "PP") : "—"}
              </div>
              <div className="text-foreground">
                Actual{" "}
                {m.actual_date ? format(new Date(m.actual_date), "PP") : "—"}
              </div>
            </div>
            <Badge variant="outline" className="ml-2">
              {m.status ?? "—"}
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------

function PhotosTab({ feed }: { feed: PortalFeed }) {
  const photos = feed.photos ?? [];
  if (photos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <ImageIcon className="mx-auto mb-2 h-5 w-5" />
        Nothing shared yet.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {photos.map((p) => (
        <PortalPhoto key={p.id} path={p.storage_path} caption={p.caption} />
      ))}
    </div>
  );
}

function PortalPhoto({
  path,
  caption,
}: {
  path: string;
  caption: string | null;
}) {
  const signFn = useServerFn(getPortalPhotoSignedUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    signFn({ data: { storagePath: path } })
      .then((r) => {
        if (!cancelled) setUrl(r.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, signFn]);
  return (
    <figure className="overflow-hidden rounded-md border border-border bg-muted">
      <div className="aspect-square bg-muted">
        {url ? (
          <img
            src={url}
            alt={caption ?? "Site photo"}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </div>
      {caption ? (
        <figcaption className="truncate p-2 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------

function ApprovalsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(getPortalApprovals);
  const decideFn = useServerFn(decidePortalApproval);
  const q = useQuery({
    queryKey: ["portal", "approvals", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const [active, setActive] = useState<PortalApprovalRow | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [comment, setComment] = useState("");

  const mut = useMutation({
    mutationFn: (input: {
      approvalId: string;
      decision: "approved" | "rejected";
      comment: string | null;
    }) => decideFn({ data: input }),
    onSuccess: () => {
      toast.success("Decision recorded");
      setActive(null);
      setComment("");
      qc.invalidateQueries({ queryKey: ["portal", "approvals", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");

  if (q.isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (pending.length === 0 && rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nothing pending.
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.approval_id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
          >
            <ApprovalStatusIcon status={r.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {r.title}
              </div>
              <div className="text-xs text-muted-foreground">
                {r.entity_type} · step {r.step_order}
                {r.amount != null
                  ? ` · $${r.amount.toLocaleString()}`
                  : ""}
              </div>
            </div>
            {r.sla_due_at ? (
              <div className="text-right text-[11px] text-muted-foreground">
                Due {format(new Date(r.sla_due_at), "PP p")}
              </div>
            ) : null}
            {r.status === "pending" ? (
              <Button size="sm" onClick={() => setActive(r)}>
                Decide
              </Button>
            ) : (
              <Badge variant="outline">{r.status}</Badge>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={Boolean(active)}
        onOpenChange={(v) => {
          if (!v) {
            setActive(null);
            setComment("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decide approval</DialogTitle>
            <DialogDescription>
              {active?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={decision === "approved" ? "default" : "outline"}
                onClick={() => setDecision("approved")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
              </Button>
              <Button
                type="button"
                variant={decision === "rejected" ? "destructive" : "outline"}
                onClick={() => setDecision("rejected")}
              >
                <XCircle className="mr-2 h-4 w-4" /> Reject
              </Button>
            </div>
            <Textarea
              placeholder={
                decision === "rejected"
                  ? "Comment (required on reject)"
                  : "Comment (optional)"
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                mut.isPending ||
                (decision === "rejected" && comment.trim().length === 0)
              }
              onClick={() => {
                if (!active) return;
                mut.mutate({
                  approvalId: active.approval_id,
                  decision,
                  comment: comment.trim() ? comment.trim() : null,
                });
              }}
            >
              {mut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApprovalStatusIcon({ status }: { status: string }) {
  if (status === "approved")
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "rejected")
    return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "pending")
    return <AlertCircle className="h-4 w-4 text-accent-foreground" />;
  return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------

const ticketSchema = z.object({
  subject: z.string().trim().min(3, "At least 3 characters").max(200),
  body: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});
type TicketForm = z.infer<typeof ticketSchema>;

function TicketsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyPortalTickets);
  const raiseFn = useServerFn(raisePortalTicket);
  const q = useQuery({
    queryKey: ["portal", "tickets", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const [open, setOpen] = useState(false);
  const form = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { subject: "", body: "", priority: "normal" },
  });
  const mut = useMutation({
    mutationFn: (v: TicketForm) =>
      raiseFn({
        data: {
          projectId,
          subject: v.subject,
          body: v.body ?? null,
          priority: v.priority,
        },
      }),
    onSuccess: () => {
      toast.success("Ticket raised");
      setOpen(false);
      form.reset({ subject: "", body: "", priority: "normal" });
      qc.invalidateQueries({ queryKey: ["portal", "tickets", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Raise ticket
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No tickets yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {t.subject}
                </div>
                <TicketStatusBadge status={t.status} />
                <TicketPriorityBadge priority={t.priority} />
              </div>
              {t.body ? (
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {t.body}
                </div>
              ) : null}
              <div className="mt-1 text-[11px] text-muted-foreground">
                Raised{" "}
                {formatDistanceToNow(new Date(t.created_at), {
                  addSuffix: true,
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v)
            form.reset({ subject: "", body: "", priority: "normal" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise ticket</DialogTitle>
            <DialogDescription>
              We'll notify your project team.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => mut.mutate(v))}
              className="space-y-3"
            >
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Details</FormLabel>
                    <FormControl>
                      <Textarea rows={4} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mut.isPending}>
                  {mut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Submit
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-accent text-accent-foreground",
    in_progress: "bg-primary/15 text-primary",
    resolved: "bg-muted text-muted-foreground",
    closed: "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={map[status] ?? "bg-muted text-muted-foreground"}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function TicketPriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    urgent: "bg-destructive/15 text-destructive",
    high: "bg-accent text-accent-foreground",
    normal: "bg-muted text-muted-foreground",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={map[priority] ?? "bg-muted text-muted-foreground"}>
      {priority}
    </Badge>
  );
}

// Unused import guard
export { useMemo };
