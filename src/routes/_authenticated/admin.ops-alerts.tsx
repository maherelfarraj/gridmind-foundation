// Ops alerts — super-admin watchdog inbox + rule configuration across all tenants.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
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

import { listTenants } from "@/lib/tenants.functions";
import {
  actOnOpsAlert,
  OPS_ALERT_SEVERITIES,
  OPS_ALERT_STATUSES,
  saveOpsAlertRule,
} from "@/lib/ops-alerts.functions";
import { opsAlertsQueryOptions, type OpsAlertFilters } from "@/lib/ops-alerts.query";
import type { OpsAlertRow, OpsAlertRuleRow } from "@/lib/ops-alerts.server";

export const Route = createFileRoute("/_authenticated/admin/ops-alerts")({
  head: () => ({
    meta: [
      { title: "Ops alerts — GridMind EPC Admin" },
      {
        name: "description",
        content: "Cross-tenant watchdog inbox and alert rule configuration for platform operators.",
      },
      { property: "og:title", content: "Ops alerts — GridMind EPC Admin" },
      {
        property: "og:description",
        content: "Triage cross-tenant operational alerts and manage the rules that raise them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpsAlertsPage,
});

const NOTIFY_ROLE_OPTIONS = [
  "super_admin",
  "company_admin",
  "finance_admin",
  "engineering_admin",
  "procurement_admin",
  "construction_admin",
  "hse_admin",
  "om_admin",
  "scada_admin",
] as const;

function OpsAlertsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<OpsAlertFilters>({
    status: "open",
    rule_type: "all",
    severity: "all",
  });

  const alerts = useQuery(opsAlertsQueryOptions(filters));
  const tenants = useQuery({
    queryKey: ["ops-alerts", "tenants"],
    queryFn: () => useServerFnTenants(),
    staleTime: 60_000,
  });

  const act = useServerFn(actOnOpsAlert);
  const saveRule = useServerFn(saveOpsAlertRule);
  const listTenantsFn = useServerFn(listTenants);

  function useServerFnTenants() {
    return listTenantsFn({ data: {} });
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ops-alerts"] });

  const actMutation = useMutation({
    mutationFn: (vars: { alert_id: string; action: "acknowledge" | "dismiss" }) =>
      act({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "acknowledge" ? "Alert acknowledged" : "Alert dismissed");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update the alert"),
  });

  const ruleMutation = useMutation({
    mutationFn: (vars: Parameters<typeof saveRule>[0]["data"]) => saveRule({ data: vars }),
    onSuccess: () => {
      toast.success("Rule saved");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the rule"),
  });

  const canWrite = alerts.data?.canWrite ?? false;
  const ruleTypes = Array.from(
    new Set((alerts.data?.rules ?? []).map((r) => r.rule_type)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops alerts"
        description="Cross-tenant watchdog inbox — platform-level anomalies, integration health, and operational thresholds."
      />

      {alerts.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : alerts.isError ? (
        <EmptyState
          icon={BellRing}
          title="Could not load ops alerts"
          description={(alerts.error as Error)?.message ?? "Please try again."}
        />
      ) : (
        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={filters.status}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, status: v as OpsAlertFilters["status"] }))
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {OPS_ALERT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Severity</Label>
                <Select
                  value={filters.severity}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, severity: v as OpsAlertFilters["severity"] }))
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    {OPS_ALERT_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Rule</Label>
                <Select
                  value={filters.rule_type}
                  onValueChange={(v) => setFilters((f) => ({ ...f, rule_type: v }))}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All rules</SelectItem>
                    {ruleTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(alerts.data?.alerts.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No ops alerts"
                description="Nothing has breached the configured thresholds."
              />
            ) : (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(alerts.data?.alerts as Array<OpsAlertRow & { rule_type: string | null }>).map(
                      (a) => (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-nowrap">{a.alert_date}</TableCell>
                          <TableCell>
                            <StatusBadge status={a.severity} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {a.rule_type ?? "—"}
                          </TableCell>
                          <TableCell>{a.message}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {a.entity_type}
                            {a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={a.status} />
                          </TableCell>
                          <TableCell className="space-x-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canWrite || a.status !== "open" || actMutation.isPending}
                              onClick={() =>
                                actMutation.mutate({ alert_id: a.id, action: "acknowledge" })
                              }
                            >
                              Acknowledge
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite || a.status === "dismissed"}
                              onClick={() =>
                                actMutation.mutate({ alert_id: a.id, action: "dismiss" })
                              }
                            >
                              Dismiss
                            </Button>
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            {(alerts.data?.rules.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No ops alert rules yet"
                description="Add a rule below to start monitoring for platform-level anomalies."
              />
            ) : (
              <div className="space-y-4">
                {alerts.data?.rules.map((r) => (
                  <RuleCard
                    key={r.id}
                    rule={r}
                    companies={tenants.data ?? []}
                    canWrite={canWrite}
                    saving={ruleMutation.isPending}
                    onSave={(payload) => ruleMutation.mutate({ id: r.id, ...payload })}
                  />
                ))}
              </div>
            )}

            <div className="rounded-lg border border-dashed border-border p-4">
              <h3 className="mb-3 font-medium">Add a new rule</h3>
              <RuleCard
                companies={tenants.data ?? []}
                canWrite={canWrite}
                saving={ruleMutation.isPending}
                onSave={(payload) => ruleMutation.mutate(payload)}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

interface RulePayload {
  rule_type: string;
  threshold: Record<string, unknown>;
  enabled: boolean;
  notify_role: string;
  company_id?: string | null;
}

function RuleCard({
  rule,
  companies,
  canWrite,
  saving,
  onSave,
}: {
  rule?: OpsAlertRuleRow;
  companies: Array<{ id: string; name: string }>;
  canWrite: boolean;
  saving: boolean;
  onSave: (payload: RulePayload) => void;
}) {
  const [ruleType, setRuleType] = useState(rule?.rule_type ?? "");
  const [thresholdText, setThresholdText] = useState(
    JSON.stringify(rule?.threshold ?? {}, null, 2),
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [notifyRole, setNotifyRole] = useState(rule?.notify_role ?? "super_admin");
  const [companyId, setCompanyId] = useState<string>(rule?.company_id ?? "global");
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  function submit() {
    let threshold: Record<string, unknown>;
    try {
      threshold = JSON.parse(thresholdText || "{}");
    } catch {
      setThresholdError("Threshold must be valid JSON.");
      return;
    }
    if (!ruleType.trim()) return;
    setThresholdError(null);
    onSave({
      rule_type: ruleType.trim(),
      threshold,
      enabled,
      notify_role: notifyRole,
      company_id: companyId === "global" ? null : companyId,
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label>Rule type</Label>
          <Input
            className="w-64"
            placeholder="e.g. cron_stale"
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value)}
            disabled={!canWrite || Boolean(rule)}
          />
        </div>
        <div className="space-y-1">
          <Label>Notify role</Label>
          <Select value={notifyRole} onValueChange={setNotifyRole}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFY_ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Company scope</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global (all companies)</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite} />
          <Label>Enabled</Label>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Threshold (JSON)</Label>
        <Textarea
          className="font-mono text-sm"
          rows={4}
          value={thresholdText}
          onChange={(e) => setThresholdText(e.target.value)}
          disabled={!canWrite}
        />
        {thresholdError && <p className="text-sm text-destructive">{thresholdError}</p>}
      </div>
      <Button onClick={submit} disabled={!canWrite || saving || !ruleType.trim()}>
        {rule ? "Save rule" : "Add rule"}
      </Button>
    </div>
  );
}
