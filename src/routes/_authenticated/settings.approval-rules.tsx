// P-111 — Approval rules admin (company_admin only).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import {
  APPROVAL_ENTITY_TYPES,
  APPROVAL_ROLES,
  approvalRuleInputSchema,
  type ApprovalRuleInput,
} from "@/lib/approvals.rules";
import {
  canManageApprovalRules,
  deleteApprovalRule,
  listApprovalRules,
  toggleApprovalRule,
  upsertApprovalRule,
  type ApprovalRuleRow,
} from "@/lib/approvals.functions";

export const Route = createFileRoute("/_authenticated/settings/approval-rules")({
  head: () => ({
    meta: [
      { title: "Approval rules — GridMind EPC" },
      {
        name: "description",
        content:
          "Configure threshold and multi-step approval chains for POs, contracts, gates and change orders.",
      },
      { property: "og:title", content: "Approval rules — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Configure threshold and multi-step approval chains for POs, contracts, gates and change orders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApprovalRulesPage,
});

function ApprovalRulesPage() {
  const listFn = useServerFn(listApprovalRules);
  const permFn = useServerFn(canManageApprovalRules);
  const toggleFn = useServerFn(toggleApprovalRule);
  const deleteFn = useServerFn(deleteApprovalRule);
  const qc = useQueryClient();

  const perm = useQuery({
    queryKey: ["approval-rules", "can-manage"],
    queryFn: () => permFn(),
  });

  const rules = useQuery({
    queryKey: ["approval-rules"],
    queryFn: () => listFn(),
    enabled: perm.data?.allowed === true,
  });

  const [editing, setEditing] = useState<ApprovalRuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalRuleRow | null>(null);

  const toggle = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-rules"] });
      toast.success("Rule updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-rules"] });
      toast.success("Rule deleted");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (perm.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (perm.data?.allowed !== true) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Approval rules
            </CardTitle>
            <CardDescription>Only company admins can view or edit approval rules.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Approval rules
          </h1>
          <p className="text-sm text-muted-foreground">
            Threshold triggers and sequential approver chains applied across POs, proposals, gates,
            contracts and change orders.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> New rule
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {rules.isLoading ? (
            <div className="p-6">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : rules.isError ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{(rules.error as Error).message}</p>
              <Button variant="outline" onClick={() => rules.refetch()}>
                Retry
              </Button>
            </div>
          ) : (rules.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <ShieldCheck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No approval rules yet.</p>
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create your first rule
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.rule_key}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.entity_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.threshold_amount == null
                        ? "—"
                        : formatCurrency(r.threshold_amount, r.threshold_currency)}
                    </TableCell>
                    <TableCell>{r.sla_hours} h</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.steps.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No steps</span>
                        ) : (
                          r.steps
                            .slice()
                            .sort((a, b) => a.step_order - b.step_order)
                            .map((s) => (
                              <Badge key={s.id} variant="outline">
                                {s.step_order}. {s.role}
                              </Badge>
                            ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={(v) => toggle.mutate({ id: r.id, is_active: v })}
                        disabled={toggle.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditing(r)}
                          aria-label="Edit rule"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteTarget(r)}
                          aria-label="Delete rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <RuleDialog
          open
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["approval-rules"] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <AlertDialog open={deleteTarget != null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this approval rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Historical instances remain but no new approvals will be triggered by this rule. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && del.mutate(deleteTarget.id)}
              disabled={del.isPending}
            >
              {del.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function RuleDialog(props: {
  open: boolean;
  initial: ApprovalRuleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertFn = useServerFn(upsertApprovalRule);

  const defaults = useMemo<ApprovalRuleInput>(() => {
    if (props.initial) {
      return {
        id: props.initial.id,
        rule_key: props.initial.rule_key,
        name: props.initial.name,
        description: props.initial.description ?? "",
        entity_type: props.initial.entity_type,
        threshold_amount: props.initial.threshold_amount ?? null,
        threshold_currency: props.initial.threshold_currency,
        sla_hours: props.initial.sla_hours,
        escalation_role:
          (props.initial.escalation_role as ApprovalRuleInput["escalation_role"]) ?? null,
        blocks_export: props.initial.blocks_export,
        is_active: props.initial.is_active,
        steps: props.initial.steps
          .slice()
          .sort((a, b) => a.step_order - b.step_order)
          .map((s) => ({
            step_order: s.step_order,
            role: s.role as ApprovalRuleInput["steps"][number]["role"],
            sla_hours: s.sla_hours ?? null,
          })),
      };
    }
    return {
      rule_key: "",
      name: "",
      description: "",
      entity_type: "purchase_order",
      threshold_amount: null,
      threshold_currency: "USD",
      sla_hours: 48,
      escalation_role: "company_admin",
      blocks_export: false,
      is_active: true,
      steps: [{ step_order: 1, role: "finance_admin", sla_hours: null }],
    };
  }, [props.initial]);

  const form = useForm<ApprovalRuleInput>({
    resolver: zodResolver(approvalRuleInputSchema),
    defaultValues: defaults,
  });

  const stepsFA = useFieldArray({ control: form.control, name: "steps" });

  const save = useMutation({
    mutationFn: (v: ApprovalRuleInput) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success(props.initial ? "Rule updated" : "Rule created");
      props.onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.initial ? "Edit approval rule" : "New approval rule"}</DialogTitle>
          <DialogDescription>
            Define when the approval fires and who approves in what order.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => {
              // renumber step_order to be contiguous 1..n
              const clean = {
                ...v,
                steps: v.steps.map((s, i) => ({ ...s, step_order: i + 1 })),
              };
              save.mutate(clean);
            })}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="PO over $50k → Finance" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rule_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rule key</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="po_threshold_finance"
                        disabled={props.initial != null}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={2}
                      placeholder="Optional context for approvers"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="entity_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Entity type</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPROVAL_ENTITY_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="threshold_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Threshold (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : Number(v));
                        }}
                        placeholder="e.g. 50000"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="threshold_currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={3}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="sla_hours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SLA (hours)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="escalation_role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Escalation role</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value ?? "company_admin"}
                        onValueChange={(v) => field.onChange(v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPROVAL_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col justify-center gap-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="active">Active</Label>
                  <Switch
                    id="active"
                    checked={form.watch("is_active")}
                    onCheckedChange={(v) => form.setValue("is_active", v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="blocks">Blocks export</Label>
                  <Switch
                    id="blocks"
                    checked={form.watch("blocks_export")}
                    onCheckedChange={(v) => form.setValue("blocks_export", v)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Approver chain</h3>
                  <p className="text-xs text-muted-foreground">
                    Approvals run in order. Each step waits for all approvers at that role before
                    advancing.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    stepsFA.append({
                      step_order: stepsFA.fields.length + 1,
                      role: "finance_admin",
                      sla_hours: null,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add step
                </Button>
              </div>
              <div className="space-y-2">
                {stepsFA.fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[auto_1fr_140px_auto] items-end gap-2">
                    <div className="flex flex-col items-center gap-1 pt-6">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => i > 0 && stepsFA.move(i, i - 1)}
                        disabled={i === 0}
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => i < stepsFA.fields.length - 1 && stepsFA.move(i, i + 1)}
                        disabled={i === stepsFA.fields.length - 1}
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name={`steps.${i}.role` as const}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Approver role</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {APPROVAL_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`steps.${i}.sla_hours` as const}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SLA (h)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                field.onChange(v === "" ? null : Number(v));
                              }}
                              placeholder="Inherit"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => stepsFA.remove(i)}
                      disabled={stepsFA.fields.length <= 1}
                      aria-label="Remove step"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={props.onClose}
                disabled={save.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save rule
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
