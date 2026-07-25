// P-125 — Webhook admin UI: endpoints CRUD, deliveries log, allowlist, test.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  History,
  Plus,
  Radio,
  RefreshCcw,
  Send,
  ShieldOff,
  Trash2,
} from "lucide-react";

import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookAllowlist,
  listWebhookDeliveries,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  sendWebhookTestEvent,
  setWebhookAllowlistEntry,
  updateWebhookEndpoint,
  type CreatedEndpointResult,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
} from "@/lib/webhooks.functions";
import { EXPORT_ALLOWLIST_CATALOG } from "@/lib/public-api/export-allowlist";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/settings/webhooks")({
  component: WebhooksPage,
  head: () => ({
    meta: [
      { title: "Webhooks — GridMind EPC" },
      {
        name: "description",
        content:
          "Register outbound webhook endpoints, choose which tables to emit, and inspect signed deliveries with retries.",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------

const SUGGESTED_EVENTS = [
  "*",
  "project.created",
  "project.updated",
  "work_order.created",
  "work_order.completed",
  "invoice.created",
  "invoice.paid",
  "approval.escalated",
  "hse.incident.reported",
  "webhook.test",
];

const createFormSchema = z.object({
  url: z.string().trim().url("must be a valid URL").refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be https"),
  description: z.string().trim().max(500).optional().default(""),
  events: z.string().trim().min(1, "at least one event").max(2000),
  isActive: z.boolean().default(true),
});
type CreateForm = z.infer<typeof createFormSchema>;

function statusBadge(status: "pending" | "success" | "failed") {
  const map = {
    pending: { label: "Pending", variant: "outline" as const },
    success: { label: "Success", variant: "default" as const },
    failed: { label: "Failed", variant: "destructive" as const },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function parseEventsInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

// ---------------------------------------------------------------------------

function WebhooksPage() {
  const qc = useQueryClient();
  const list = useServerFn(listWebhookEndpoints);
  const create = useServerFn(createWebhookEndpoint);
  const update = useServerFn(updateWebhookEndpoint);
  const rotate = useServerFn(rotateWebhookEndpointSecret);
  const remove = useServerFn(deleteWebhookEndpoint);
  const sendTest = useServerFn(sendWebhookTestEvent);

  const endpoints = useQuery({ queryKey: ["webhook-endpoints"], queryFn: () => list() });

  const [createOpen, setCreateOpen] = useState(false);
  const [showRaw, setShowRaw] = useState<{
    raw: string;
    url: string;
    mode: "created" | "rotated";
  } | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState<WebhookEndpointRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<WebhookEndpointRow | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpointRow | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<CreateForm>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { url: "", description: "", events: "webhook.test", isActive: true },
  });

  const createMut = useMutation({
    mutationFn: async (input: CreateForm): Promise<CreatedEndpointResult> => {
      const events = parseEventsInput(input.events);
      if (events.length === 0) throw new Error("at least one event");
      return create({
        data: {
          url: input.url,
          description: input.description?.trim() ? input.description.trim() : null,
          events,
          isActive: input.isActive,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      setCreateOpen(false);
      form.reset();
      setShowRaw({ raw: res.raw, url: res.endpoint.url, mode: "created" });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to create endpoint"),
  });

  const rotateMut = useMutation({
    mutationFn: async (id: string): Promise<CreatedEndpointResult> =>
      rotate({ data: { id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      setRotateConfirm(null);
      setShowRaw({ raw: res.raw, url: res.endpoint.url, mode: "rotated" });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to rotate secret"),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async (v: { id: string; isActive: boolean }) =>
      update({ data: { id: v.id, isActive: v.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-endpoints"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      setDeleteConfirm(null);
      toast.success("Endpoint deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const testMut = useMutation({
    mutationFn: async (endpointId: string) => sendTest({ data: { endpointId } }),
    onSuccess: () => {
      toast.success("Test event queued — dispatcher will deliver within ~5 min");
      qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to queue test event"),
  });

  const onSubmit = form.handleSubmit((v) => createMut.mutate(v));

  async function copyRaw() {
    if (!showRaw) return;
    try {
      await navigator.clipboard.writeText(showRaw.raw);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  }

  const isForbidden =
    endpoints.error instanceof Error &&
    /forbidden|401|unauth/i.test(endpoints.error.message);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Register HTTPS endpoints, pick the tables you want exported, and
            we'll POST signed events with automatic retries.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/docs/api#webhooks" target="_blank" rel="noreferrer">
              Webhook docs
            </a>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New endpoint
          </Button>
        </div>
      </div>

      <Tabs defaultValue="endpoints">
        <TabsList>
          <TabsTrigger value="endpoints">
            <Radio className="mr-1.5 h-4 w-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="allowlist">
            <ShieldOff className="mr-1.5 h-4 w-4 rotate-180" />
            Export allowlist
          </TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-4">
          {isForbidden ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <ShieldOff className="h-5 w-5" />
                  403 — Company admin only
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Webhook management is restricted to company administrators.
              </CardContent>
            </Card>
          ) : endpoints.error ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Could not load webhook endpoints
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>{endpoints.error.message}</p>
                <Button variant="outline" size="sm" onClick={() => endpoints.refetch()}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : endpoints.isLoading ? (
            <Card>
              <CardContent className="space-y-2 p-6">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ) : endpoints.data && endpoints.data.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
                <Radio className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No webhook endpoints yet</p>
                  <p className="text-sm text-muted-foreground">
                    Add one to receive signed events for your integrations.
                  </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New endpoint
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {endpoints.data!.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="max-w-[280px]">
                          <div className="truncate font-mono text-xs">{e.url}</div>
                          {e.description ? (
                            <div className="text-xs text-muted-foreground">
                              {e.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {e.events.slice(0, 4).map((ev) => (
                              <Badge
                                key={ev}
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                {ev}
                              </Badge>
                            ))}
                            {e.events.length > 4 ? (
                              <Badge variant="outline" className="text-[10px]">
                                +{e.events.length - 4}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={e.is_active}
                              onCheckedChange={(v) =>
                                toggleActiveMut.mutate({ id: e.id, isActive: v })
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              {e.is_active ? "Active" : "Paused"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNowStrict(new Date(e.created_at), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => testMut.mutate(e.id)}
                              disabled={!e.is_active}
                            >
                              <Send className="mr-1 h-3.5 w-3.5" />
                              Test
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeliveriesFor(e)}
                            >
                              <History className="mr-1 h-3.5 w-3.5" />
                              Log
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRotateConfirm(e)}
                            >
                              <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                              Rotate
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(e)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="allowlist" className="mt-4">
          <ExportAllowlistSection isForbidden={isForbidden} />
        </TabsContent>
      </Tabs>

      {/* ---------------- Create dialog ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New webhook endpoint</DialogTitle>
            <DialogDescription>
              Only HTTPS URLs are accepted. A signing secret will be generated
              and shown once.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                placeholder="https://example.com/webhooks/gridmind"
                {...form.register("url")}
              />
              {form.formState.errors.url ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.url.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-desc">Description (optional)</Label>
              <Input
                id="wh-desc"
                placeholder="What is this endpoint for?"
                {...form.register("description")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-events">Events</Label>
              <Textarea
                id="wh-events"
                rows={3}
                placeholder="project.created, work_order.completed, invoice.paid"
                {...form.register("events")}
              />
              <p className="text-xs text-muted-foreground">
                Comma- or space-separated. Use <code>*</code> to subscribe to
                every event.
              </p>
              <div className="flex flex-wrap gap-1 pt-1">
                {SUGGESTED_EVENTS.map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    className="rounded border border-input bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                    onClick={() => {
                      const cur = parseEventsInput(form.getValues("events"));
                      if (!cur.includes(ev)) {
                        form.setValue("events", [...cur, ev].join(", "), {
                          shouldDirty: true,
                        });
                      }
                    }}
                  >
                    +{ev}
                  </button>
                ))}
              </div>
              {form.formState.errors.events ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.events.message}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="wh-active"
                checked={form.watch("isActive")}
                onCheckedChange={(v) => form.setValue("isActive", v)}
              />
              <Label htmlFor="wh-active" className="text-sm">
                Active on creation
              </Label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                Create endpoint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- Show-once secret dialog ---------------- */}
      <Dialog open={!!showRaw} onOpenChange={(v) => !v && setShowRaw(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {showRaw?.mode === "rotated"
                ? "New signing secret"
                : "Endpoint created"}
            </DialogTitle>
            <DialogDescription>
              Store this now — it will never be shown again. Use it to verify
              incoming <code>x-gridmind-signature</code> headers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">{showRaw?.url}</span>
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={showRaw?.raw ?? ""}
                className="font-mono text-xs"
              />
              <Button size="icon" variant="outline" onClick={copyRaw}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRaw(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Rotate confirm ---------------- */}
      <AlertDialog
        open={!!rotateConfirm}
        onOpenChange={(v) => !v && setRotateConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret will stop signing new deliveries immediately.
              Update your receiver with the new value before the next event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rotateConfirm && rotateMut.mutate(rotateConfirm.id)}
            >
              Rotate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- Delete confirm ---------------- */}
      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              Pending deliveries for this endpoint will be dropped. The action
              is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- Deliveries drawer (dialog) ---------------- */}
      <Dialog
        open={!!deliveriesFor}
        onOpenChange={(v) => !v && setDeliveriesFor(null)}
      >
        <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              Deliveries — <span className="font-mono text-sm">{deliveriesFor?.url}</span>
            </DialogTitle>
            <DialogDescription>
              Last 50 delivery attempts. Failures retry on a 1m → 5m → 30m →
              2h → 24h schedule.
            </DialogDescription>
          </DialogHeader>
          {deliveriesFor ? <DeliveriesTable endpointId={deliveriesFor.id} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DeliveriesTable({ endpointId }: { endpointId: string }) {
  const list = useServerFn(listWebhookDeliveries);
  const q = useQuery({
    queryKey: ["webhook-deliveries", endpointId],
    queryFn: () => list({ data: { endpointId, limit: 50 } }),
    refetchInterval: 15_000,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="p-4 text-sm text-destructive">
        {q.error instanceof Error ? q.error.message : "Failed to load"}
      </div>
    );
  }
  const rows = (q.data ?? []) as WebhookDeliveryRow[];
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No deliveries yet. Send a test event to try it out.
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Response</TableHead>
            <TableHead>Next retry</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <DeliveryRow key={r.id} row={r} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DeliveryRow({ row }: { row: WebhookDeliveryRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">{row.event}</TableCell>
        <TableCell>{statusBadge(row.status)}</TableCell>
        <TableCell className="text-sm">{row.attempts}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {row.response_status ?? "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {row.next_retry_at
            ? formatDistanceToNowStrict(new Date(row.next_retry_at), {
                addSuffix: true,
              })
            : "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            {format(new Date(row.created_at), "yyyy-MM-dd HH:mm:ss")}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-medium uppercase text-muted-foreground">
                  Payload
                </p>
                <pre className="max-h-48 overflow-auto rounded bg-background p-2 text-xs">
                  {JSON.stringify(row.payload, null, 2)}
                </pre>
              </div>
              {row.response_body ? (
                <div>
                  <p className="text-[10px] font-medium uppercase text-muted-foreground">
                    Response body (truncated at 2 KB)
                  </p>
                  <pre className="max-h-32 overflow-auto rounded bg-background p-2 text-xs">
                    {row.response_body}
                  </pre>
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function ExportAllowlistSection({ isForbidden }: { isForbidden: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listWebhookAllowlist);
  const set = useServerFn(setWebhookAllowlistEntry);

  const q = useQuery({
    queryKey: ["webhook-allowlist"],
    queryFn: () => list(),
  });

  const enabledMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of q.data ?? []) m.set(r.table_name, r.is_enabled);
    return m;
  }, [q.data]);

  const setMut = useMutation({
    mutationFn: async (v: { table: string; enabled: boolean }) =>
      set({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["webhook-allowlist"] });
      const prev = qc.getQueryData<{ table_name: string; is_enabled: boolean }[]>([
        "webhook-allowlist",
      ]);
      const next = [...(prev ?? []).filter((r) => r.table_name !== v.table), {
        table_name: v.table,
        is_enabled: v.enabled,
      }];
      qc.setQueryData(["webhook-allowlist"], next);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["webhook-allowlist"], ctx?.prev);
      toast.error(e instanceof Error ? e.message : "Update failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["webhook-allowlist"] }),
  });

  if (isForbidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-5 w-5" />
            403 — Company admin only
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Only company administrators can edit the export allowlist.
        </CardContent>
      </Card>
    );
  }

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export allowlist</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enable a table to allow row-change events on it to be emitted as
          webhooks. Nothing is emitted for tables that are off.
        </p>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {EXPORT_ALLOWLIST_CATALOG.map((domain) => {
            const enabledCount = domain.tables.filter((t) =>
              enabledMap.get(t.table),
            ).length;
            return (
              <AccordionItem key={domain.key} value={domain.key}>
                <AccordionTrigger>
                  <div className="flex flex-1 items-center justify-between pr-2">
                    <span>{domain.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {enabledCount} / {domain.tables.length} enabled
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                    {domain.tables.map((t) => {
                      const enabled = enabledMap.get(t.table) === true;
                      return (
                        <label
                          key={t.table}
                          className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm"
                        >
                          <span>
                            {t.label}
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                              {t.table}
                            </span>
                          </span>
                          <Checkbox
                            checked={enabled}
                            onCheckedChange={(v) =>
                              setMut.mutate({ table: t.table, enabled: v === true })
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
