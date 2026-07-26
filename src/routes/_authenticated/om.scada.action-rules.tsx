// P-176 — SCADA→O&M action rules CRUD + action log.
// Governance: contractual actions always require P-111 approval; AI is advisory.
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Plus, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteActionRule,
  listActionLog,
  listActionRules,
  saveActionRule,
  toggleActionRule,
} from "@/lib/scada-actions.functions";
import type { ActionLogRow, ActionRuleRow } from "@/lib/scada-actions.server";
import {
  ACTION_LABELS,
  EVENT_ACTION_TYPES,
  isContractualAction,
  type EventActionType,
} from "@/lib/scada/action-rules";
import { SCADA_EVENT_SEVERITIES, SCADA_EVENT_TYPES } from "@/lib/scada/events";

export const Route = createFileRoute("/_authenticated/om/scada/action-rules")({
  head: () => ({
    meta: [
      { title: "SCADA action rules · GridMind EPC" },
      {
        name: "description",
        content:
          "Route SCADA events into O&M work: rule matching, approval-gated actions, execution log and advisory AI recommendations.",
      },
      { property: "og:title", content: "SCADA action rules · GridMind EPC" },
      {
        property: "og:description",
        content: "Approval-gated automation from SCADA events to O&M actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActionRulesPage,
});

// Local form schema (plain shape so react-hook-form gets stable defaults).
const formSchema = z.object({
  name: z.string().trim().min(2, "Give the rule a name").max(120),
  event_type: z.enum(SCADA_EVENT_TYPES),
  min_severity: z.enum(SCADA_EVENT_SEVERITIES),
  action_type: z.enum(EVENT_ACTION_TYPES),
  match_json: z.string(),
  config_json: z.string(),
  requires_approval: z.boolean(),
  approval_rule_key: z.string().trim().min(2).max(80),
  ai_assist: z.boolean(),
  enabled: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const DEFAULTS: FormValues = {
  name: "",
  event_type: "trip",
  min_severity: "major",
  action_type: "create_work_order",
  match_json: "{}",
  config_json: "{}",
  requires_approval: true,
  approval_rule_key: "scada_event_action",
  ai_assist: false,
  enabled: true,
};

const STATUS_TONE: Record<string, StatusTone> = {
  executed: "positive",
  approved: "active",
  pending_approval: "attention",
  rejected: "critical",
  failed: "critical",
  skipped: "inactive",
};

function parseJsonField(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new Error(`${label} must be a JSON object`);
}

function ActionRulesPage() {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ActionRuleRow | null>(null);

  const listFn = useServerFn(listActionRules);
  const logFn = useServerFn(listActionLog);
  const saveFn = useServerFn(saveActionRule);
  const toggleFn = useServerFn(toggleActionRule);
  const deleteFn = useServerFn(deleteActionRule);

  const rulesQ = useQuery({ queryKey: ["scada-action-rules"], queryFn: () => listFn() });
  const logQ = useQuery({ queryKey: ["scada-action-log"], queryFn: () => logFn() });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: DEFAULTS });
  const actionType = form.watch("action_type") as EventActionType;
  const contractual = isContractualAction(actionType);

  useEffect(() => {
    if (contractual) form.setValue("requires_approval", true);
  }, [contractual, form]);

  const saveMut = useMutation({
    mutationFn: async (values: FormValues) => {
      const match = parseJsonField(values.match_json, "Match filter");
      const action_config = parseJsonField(values.config_json, "Action config");
      return saveFn({
        data: {
          id: editing?.id ?? null,
          values: {
            name: values.name,
            project_id: editing?.project_id ?? null,
            event_type: values.event_type,
            min_severity: values.min_severity,
            match,
            action_type: values.action_type,
            action_config,
            requires_approval: values.requires_approval,
            approval_rule_key: values.approval_rule_key,
            ai_assist: values.ai_assist,
            enabled: values.enabled,
          },
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Rule updated" : "Rule created");
      setSheetOpen(false);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["scada-action-rules"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save rule"),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggleFn({ data: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["scada-action-rules"] }),
    onError: () => toast.error("Could not change the rule"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Rule deleted");
      void qc.invalidateQueries({ queryKey: ["scada-action-rules"] });
    },
    onError: () => toast.error("Could not delete the rule"),
  });

  function openCreate() {
    setEditing(null);
    form.reset(DEFAULTS);
    setSheetOpen(true);
  }

  function openEdit(rule: ActionRuleRow) {
    setEditing(rule);
    form.reset({
      name: rule.name,
      event_type: rule.event_type as FormValues["event_type"],
      min_severity: rule.min_severity as FormValues["min_severity"],
      action_type: rule.action_type,
      match_json: JSON.stringify(rule.match ?? {}, null, 2),
      config_json: JSON.stringify(rule.action_config ?? {}, null, 2),
      requires_approval: rule.requires_approval,
      approval_rule_key: rule.approval_rule_key,
      ai_assist: rule.ai_assist,
      enabled: rule.enabled,
    });
    setSheetOpen(true);
  }

  const canManage = rulesQ.data?.canManage === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SCADA action rules"
        description="Deterministic routing from SCADA events into O&M work. The approval engine is the final authority — AI only recommends."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New rule
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="log">Action log</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Workflow className="h-4 w-4 text-muted-foreground" />
                Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rulesQ.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : rulesQ.isError ? (
                <EmptyState
                  title="Could not load rules"
                  description="The rule list failed to load."
                  action={
                    <Button variant="outline" onClick={() => void rulesQ.refetch()}>
                      Retry
                    </Button>
                  }
                />
              ) : (rulesQ.data?.rules.length ?? 0) === 0 ? (
                <EmptyState
                  title="No action rules yet"
                  description="Create a rule to turn SCADA events into work orders, tickets and approval-gated client actions."
                  action={canManage ? <Button onClick={openCreate}>New rule</Button> : undefined}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Min severity</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead>AI</TableHead>
                      <TableHead className="text-right">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rulesQ.data!.rules.map((rule) => (
                      <TableRow
                        key={rule.id}
                        className="cursor-pointer"
                        onClick={() => canManage && openEdit(rule)}
                      >
                        <TableCell className="font-medium">
                          {rule.name}
                          {rule.project_name ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {rule.project_name}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{rule.event_type}</TableCell>
                        <TableCell className="text-muted-foreground">{rule.min_severity}</TableCell>
                        <TableCell>{ACTION_LABELS[rule.action_type]}</TableCell>
                        <TableCell>
                          {isContractualAction(rule.action_type) ? (
                            <Badge variant="outline" className="gap-1">
                              <ShieldCheck className="h-3 w-3" />
                              Always required
                            </Badge>
                          ) : rule.requires_approval ? (
                            <Badge variant="outline">Required</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Auto-execute</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {rule.ai_assist ? (
                            <Badge variant="secondary" className="gap-1">
                              <Bot className="h-3 w-3" />
                              Advisory
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="flex items-center justify-end gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Switch
                              checked={rule.enabled}
                              disabled={!canManage || toggleMut.isPending}
                              onCheckedChange={(checked) =>
                                toggleMut.mutate({ id: rule.id, enabled: checked })
                              }
                              aria-label={`Toggle ${rule.name}`}
                            />
                            {canManage ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${rule.name}`}
                                onClick={() => deleteMut.mutate(rule.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <ActionLogPanel
            rows={logQ.data?.rows ?? []}
            isLoading={logQ.isLoading}
            isError={logQ.isError}
            onRetry={() => void logQ.refetch()}
          />
        </TabsContent>
      </Tabs>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit action rule" : "New action rule"}</SheetTitle>
          </SheetHeader>
          <Form {...form}>
            <form
              className="mt-6 space-y-5"
              onSubmit={form.handleSubmit((v) => saveMut.mutate(v))}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Inverter trip → work order" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="event_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SCADA_EVENT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="min_severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum severity</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SCADA_EVENT_SEVERITIES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="match_json"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Match filter (JSON)</FormLabel>
                    <FormControl>
                      <Textarea rows={4} className="font-mono text-xs" {...field} />
                    </FormControl>
                    <FormDescription>
                      Optional keys: code_in, message_contains, source_in, asset_node_ids,
                      payload_equals.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="action_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EVENT_ACTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {ACTION_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="config_json"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action config (JSON)</FormLabel>
                    <FormControl>
                      <Textarea rows={5} className="font-mono text-xs" {...field} />
                    </FormControl>
                    <FormDescription>
                      Per action: title, description, priority; assign_technician needs user_id;
                      spare_parts_request needs spare_part_id + quantity; warranty_claim needs
                      warranty_id.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="requires_approval"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div className="space-y-1">
                      <FormLabel>Require approval</FormLabel>
                      <FormDescription>
                        {contractual
                          ? "Contractual and safety-critical actions always route through the approval engine."
                          : "Turn off to execute operational actions immediately."}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={contractual ? true : field.value}
                        disabled={contractual}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="approval_rule_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Approval rule key</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ai_assist"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div className="space-y-1">
                      <FormLabel>AI assist</FormLabel>
                      <FormDescription>
                        Stores an advisory recommendation on the log entry. It never approves or
                        executes anything.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>Enabled</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMut.isPending}>
                  {saveMut.isPending ? "Saving…" : "Save rule"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActionLogPanel({
  rows,
  isLoading,
  isError,
  onRetry,
}: {
  rows: ActionLogRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        title="Could not load the action log"
        description="The execution log failed to load."
        action={
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No actions yet"
        description="Matched events will appear here with their approval and execution state."
      />
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={row.status.replace("_", " ")}
                tone={STATUS_TONE[row.status] ?? "neutral"}
              />
              <span className="font-medium">{ACTION_LABELS[row.action_type]}</span>
              <span className="text-sm text-muted-foreground">{row.rule_name ?? "rule removed"}</span>
              {isContractualAction(row.action_type) ? (
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Approval-gated
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {row.event_message ?? "Event removed"}
              {row.event_severity ? ` · ${row.event_severity}` : ""}
              {row.project_name ? ` · ${row.project_name}` : ""}
            </p>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {row.approval_instance_id ? (
                <Link to="/approvals" className="underline underline-offset-2">
                  Approval {row.approval_status ?? "pending"}
                </Link>
              ) : (
                <span>No approval instance</span>
              )}
              {row.result_entity ? (
                <span>
                  Result: {row.result_entity} {row.result_entity_id?.slice(0, 8)}
                </span>
              ) : null}
              {row.executed_at ? <span>Executed {row.executed_at.slice(0, 16)}</span> : null}
            </div>
            {row.error ? <p className="text-xs text-destructive">Error: {row.error}</p> : null}
            {row.ai_suggestion ? (
              <div className="rounded-md border border-dashed p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">AI recommendation — advisory only</span>
                </div>
                <pre className="overflow-x-auto text-xs text-muted-foreground">
                  {JSON.stringify(row.ai_suggestion, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
