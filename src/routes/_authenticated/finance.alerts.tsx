// P-199 — Finance alerts: watchdog inbox + rule configuration.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { Num } from "@/components/ui/num";

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
import { AGING_BUCKETS, AGING_BUCKET_LABELS } from "@/lib/finance/aging-weights";
import { actOnFinanceAlert, saveFinanceAlertRule } from "@/lib/finance-alerts.functions";
import {
  financeAlertAccessQueryOptions,
  financeAlertsQueryOptions,
} from "@/lib/finance-alerts.query";
import {
  FINANCE_ALERT_RULE_TYPES,
  FINANCE_ALERT_STATUSES,
  NOTIFY_ROLE_OPTIONS,
  alertStatusTone,
  defaultThreshold,
  ruleTypeHint,
  ruleTypeLabel,
  severityTone,
  type FinanceAlertRuleType,
  type ListAlertsInput,
  type ThresholdMap,
} from "@/lib/finance-alerts.rules";
import type { FinanceAlertRuleRow } from "@/lib/finance-alerts.server";

export const Route = createFileRoute("/_authenticated/finance/alerts")({
  head: () => ({
    meta: [
      { title: "Finance alerts — GridMind EPC" },
      {
        name: "description",
        content:
          "Daily watchdog for overdue invoices, AR aging breaches, unbilled certified work and unmatched payments.",
      },
      { property: "og:title", content: "Finance alerts — GridMind EPC" },
      {
        property: "og:description",
        content: "Configure finance alert rules and triage the alerts they raise each morning.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinanceAlertsPage,
});

function FinanceAlertsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ListAlertsInput>({ status: "open", rule_type: "all" });

  const access = useQuery(financeAlertAccessQueryOptions());
  const alerts = useQuery(financeAlertsQueryOptions(filters));

  const act = useServerFn(actOnFinanceAlert);
  const saveRule = useServerFn(saveFinanceAlertRule);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["finance-alerts"] });

  const actMutation = useMutation({
    mutationFn: (vars: { alert_id: string; action: "acknowledge" | "dismiss" }) =>
      act({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.action === "acknowledge"
          ? t("financeMod.alerts.toastAcknowledged")
          : t("financeMod.alerts.toastDismissed"),
      );
      void invalidate();
    },
    onError: (e) =>
      toast.error(translateError(t, errorCodeOf(e), (e as Error)?.message) || t("financeMod.alerts.couldNotUpdateAlert")),
  });

  const ruleMutation = useMutation({
    mutationFn: (vars: {
      rule_type: FinanceAlertRuleType;
      threshold: ThresholdMap;
      enabled: boolean;
      notify_role: (typeof NOTIFY_ROLE_OPTIONS)[number];
    }) => saveRule({ data: vars }),
    onSuccess: () => {
      toast.success(t("financeMod.alerts.toastRuleSaved"));
      void invalidate();
    },
    onError: (e) =>
      toast.error(translateError(t, errorCodeOf(e), (e as Error)?.message) || t("financeMod.alerts.couldNotSaveRule")),
  });

  const canWrite = access.data === "full";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("financeMod.alerts.title")}
        description={t("financeMod.alerts.subtitle")}
      />

      {access.isLoading || alerts.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : alerts.isError ? (
        <EmptyState
          icon={BellRing}
          title={t("financeMod.alerts.couldNotLoadAlerts")}
          description={translateError(t, errorCodeOf(alerts.error), (alerts.error as Error)?.message)}
        />
      ) : (
        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">{t("financeMod.alerts.tabAlerts")}</TabsTrigger>
            <TabsTrigger value="rules">{t("financeMod.alerts.tabRules")}</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label>{t("common.status")}</Label>
                <Select
                  value={filters.status}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, status: v as ListAlertsInput["status"] }))
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("financeMod.alerts.filterAllStatuses")}</SelectItem>
                    {FINANCE_ALERT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("financeMod.alerts.rule")}</Label>
                <Select
                  value={filters.rule_type}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, rule_type: v as ListAlertsInput["rule_type"] }))
                  }
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("financeMod.alerts.filterAllRules")}</SelectItem>
                    {FINANCE_ALERT_RULE_TYPES.map((rt) => (
                      <SelectItem key={rt} value={rt}>
                        {ruleTypeLabel(rt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(alerts.data?.alerts.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title={t("financeMod.alerts.noAlerts")}
                description={t("financeMod.alerts.noAlertsDesc")}
              />
            ) : (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.date")}</TableHead>
                      <TableHead>{t("financeMod.alerts.severity")}</TableHead>
                      <TableHead>{t("financeMod.alerts.rule")}</TableHead>
                      <TableHead>{t("financeMod.alerts.messageHeader")}</TableHead>
                      <TableHead>{t("financeMod.alerts.entityHeader")}</TableHead>
                      <TableHead>{t("common.status")}</TableHead>
                      <TableHead className="text-end">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.data?.alerts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap">
                          <Num>{a.alert_date}</Num>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={a.severity} tone={severityTone(a.severity)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {a.rule_type ? ruleTypeLabel(a.rule_type as FinanceAlertRuleType) : "—"}
                        </TableCell>
                        <TableCell>{a.message}</TableCell>
                        <TableCell className="text-muted-foreground">{a.entity_type}</TableCell>
                        <TableCell>
                          <StatusBadge status={a.status} tone={alertStatusTone(a.status)} />
                        </TableCell>
                        <TableCell className="space-x-2 text-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canWrite || a.status !== "open" || actMutation.isPending}
                            onClick={() =>
                              actMutation.mutate({ alert_id: a.id, action: "acknowledge" })
                            }
                          >
                            {t("financeMod.alerts.acknowledge")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite || a.status === "dismissed"}
                            onClick={() =>
                              actMutation.mutate({ alert_id: a.id, action: "dismiss" })
                            }
                          >
                            {t("financeMod.alerts.dismiss")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            {FINANCE_ALERT_RULE_TYPES.map((rt) => (
              <RuleCard
                key={rt}
                ruleType={rt}
                rule={alerts.data?.rules.find((r) => r.rule_type === rt)}
                canWrite={canWrite}
                saving={ruleMutation.isPending}
                onSave={(payload) => ruleMutation.mutate({ rule_type: rt, ...payload })}
              />
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

interface RulePayload {
  threshold: ThresholdMap;
  enabled: boolean;
  notify_role: (typeof NOTIFY_ROLE_OPTIONS)[number];
}

function RuleCard({
  ruleType,
  rule,
  canWrite,
  saving,
  onSave,
}: {
  ruleType: FinanceAlertRuleType;
  rule?: FinanceAlertRuleRow;
  canWrite: boolean;
  saving: boolean;
  onSave: (payload: RulePayload) => void;
}) {
  const { t } = useI18n();
  const initial = (rule?.threshold ?? defaultThreshold(ruleType)) as ThresholdMap;
  const [days, setDays] = useState(String(initial.days ?? ""));
  const [amount, setAmount] = useState(String(initial.amount_base ?? ""));
  const [bucket, setBucket] = useState(String(initial.bucket ?? "d90_plus"));
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [notifyRole, setNotifyRole] = useState(
    (rule?.notify_role ?? "finance_admin") as (typeof NOTIFY_ROLE_OPTIONS)[number],
  );

  const usesDays = ruleType === "overdue_invoice_days" || ruleType === "payment_unmatched_days";
  const usesAmount = ruleType === "ar_aging_threshold" || ruleType === "unbilled_certified_value";

  function submit() {
    const threshold: ThresholdMap = usesDays
      ? { days: Number(days || 0) }
      : ruleType === "ar_aging_threshold"
        ? { amount_base: Number(amount || 0), bucket }
        : { amount_base: Number(amount || 0) };
    onSave({ threshold, enabled, notify_role: notifyRole });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h3 className="font-medium">{ruleTypeLabel(ruleType)}</h3>
        <p className="text-sm text-muted-foreground">{ruleTypeHint(ruleType)}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {usesDays && (
          <div className="space-y-1">
            <Label>{t("financeMod.alerts.daysLabel")}</Label>
            <Input
              className="w-28"
              type="number"
              min={0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        )}
        {usesAmount && (
          <div className="space-y-1">
            <Label>{t("financeMod.alerts.amountBaseLabel")}</Label>
            <Input
              className="w-40"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        )}
        {ruleType === "ar_aging_threshold" && (
          <div className="space-y-1">
            <Label>{t("financeMod.alerts.bucketLabel")}</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGING_BUCKETS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {AGING_BUCKET_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label>{t("financeMod.alerts.notifyRoleLabel")}</Label>
          <Select
            value={notifyRole}
            onValueChange={(v) => setNotifyRole(v as (typeof NOTIFY_ROLE_OPTIONS)[number])}
          >
            <SelectTrigger className="w-48">
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
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite} />
          <Label>{t("financeMod.alerts.enabledLabel")}</Label>
        </div>
        <Button onClick={submit} disabled={!canWrite || saving}>
          {t("financeMod.alerts.saveRule")}
        </Button>
      </div>
    </div>
  );
}
