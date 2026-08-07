// GC-10 — Company-configurable alert thresholds, lead times and SLAs.
// Validation is shared with the server (`alertConfigUpdateSchema`), so the
// browser can never persist a threshold the evaluator would reject.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  ALERT_SEVERITIES,
  alertConfigUpdateSchema,
  type AlertConfigUpdate,
  type AlertRuleConfig,
} from "@/lib/portfolio-alerts.rules";

const K = "portfolioMod.costing.alerts";

export interface AlertConfigPanelProps {
  configs: readonly AlertRuleConfig[];
  busyRule: string | null;
  onSave: (update: AlertConfigUpdate) => void;
  onInvalid: (message: string) => void;
}

export function AlertConfigPanel({ configs, busyRule, onSave, onInvalid }: AlertConfigPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, Partial<AlertRuleConfig>>>({});

  const valueOf = (cfg: AlertRuleConfig): AlertRuleConfig =>
    ({ ...cfg, ...(draft[cfg.rule_type] ?? {}) }) as AlertRuleConfig;

  const patch = (rule: string, next: Partial<AlertRuleConfig>) =>
    setDraft((d) => ({ ...d, [rule]: { ...(d[rule] ?? {}), ...next } }));

  const save = (cfg: AlertRuleConfig) => {
    const merged = valueOf(cfg);
    const parsed = alertConfigUpdateSchema.safeParse({
      rule_type: merged.rule_type,
      enabled: merged.enabled,
      severity: merged.severity,
      threshold_value: merged.threshold_value === null ? null : Number(merged.threshold_value),
      lead_days: Number(merged.lead_days),
      ack_sla_hours: Number(merged.ack_sla_hours),
      notify_roles: merged.notify_roles,
      escalate_roles: merged.escalate_roles,
    });
    if (!parsed.success) {
      onInvalid(
        t(`${K}.config.invalid.${parsed.error.issues[0]?.message ?? "threshold_out_of_range"}`),
      );
      return;
    }
    onSave(parsed.data);
  };

  return (
    <Table>
      <caption className="text-muted-foreground px-4 py-2 text-start text-xs">
        {t(`${K}.config.caption`)}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.col.rule`)}</TableHead>
          <TableHead scope="col">{t(`${K}.config.enabled`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.severity`)}</TableHead>
          <TableHead scope="col">{t(`${K}.config.threshold`)}</TableHead>
          <TableHead scope="col">{t(`${K}.config.leadDays`)}</TableHead>
          <TableHead scope="col">{t(`${K}.config.slaHours`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.actions`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {configs.map((base) => {
          const cfg = valueOf(base);
          const id = `alert-cfg-${cfg.rule_type}`;
          return (
            <TableRow key={cfg.rule_type}>
              <TableCell className="font-medium">{t(`${K}.rule.${cfg.rule_type}`)}</TableCell>
              <TableCell>
                <Switch
                  id={`${id}-enabled`}
                  checked={cfg.enabled}
                  aria-label={t(`${K}.config.enabledFor`, {
                    rule: t(`${K}.rule.${cfg.rule_type}`),
                  })}
                  onCheckedChange={(v) => patch(cfg.rule_type, { enabled: v })}
                />
              </TableCell>
              <TableCell>
                <Label htmlFor={`${id}-severity`} className="sr-only">
                  {t(`${K}.config.severityFor`, { rule: t(`${K}.rule.${cfg.rule_type}`) })}
                </Label>
                <Select
                  value={cfg.severity}
                  onValueChange={(v) =>
                    patch(cfg.rule_type, { severity: v as AlertRuleConfig["severity"] })
                  }
                >
                  <SelectTrigger id={`${id}-severity`} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALERT_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`${K}.severity.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Label htmlFor={`${id}-threshold`} className="sr-only">
                  {t(`${K}.config.thresholdFor`, {
                    rule: t(`${K}.rule.${cfg.rule_type}`),
                    unit: t(`${K}.config.unit.${cfg.threshold_unit}`),
                  })}
                </Label>
                <Input
                  id={`${id}-threshold`}
                  type="number"
                  step="any"
                  className="w-28"
                  value={cfg.threshold_value ?? ""}
                  onChange={(e) =>
                    patch(cfg.rule_type, {
                      threshold_value: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="text-muted-foreground ms-2 text-xs">
                  {t(`${K}.config.unit.${cfg.threshold_unit}`)}
                </span>
              </TableCell>
              <TableCell>
                <Label htmlFor={`${id}-lead`} className="sr-only">
                  {t(`${K}.config.leadDaysFor`, { rule: t(`${K}.rule.${cfg.rule_type}`) })}
                </Label>
                <Input
                  id={`${id}-lead`}
                  type="number"
                  min={0}
                  max={90}
                  className="w-24"
                  value={cfg.lead_days}
                  onChange={(e) => patch(cfg.rule_type, { lead_days: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <Label htmlFor={`${id}-sla`} className="sr-only">
                  {t(`${K}.config.slaHoursFor`, { rule: t(`${K}.rule.${cfg.rule_type}`) })}
                </Label>
                <Input
                  id={`${id}-sla`}
                  type="number"
                  min={1}
                  max={720}
                  className="w-24"
                  value={cfg.ack_sla_hours}
                  onChange={(e) => patch(cfg.rule_type, { ack_sla_hours: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyRule === cfg.rule_type}
                  onClick={() => save(base)}
                  aria-label={t(`${K}.config.saveFor`, { rule: t(`${K}.rule.${cfg.rule_type}`) })}
                >
                  {t(`${K}.config.save`)}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
