// P-105 — Server-side alarm evaluator. Called fire-and-forget from the
// SCADA telemetry ingestion hook using the service-role client (bypasses RLS
// because raises happen without a user session).
//
// TODO(B13/P-123): escalation cron advances escalation_level and notifies notify_role.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateCondition,
  hasCleared,
  type AlarmCondition,
  type AlarmSeverity,
} from "@/lib/alarms.rules";

interface RuleRow {
  id: string;
  company_id: string;
  project_id: string | null;
  name: string;
  metric: string;
  condition: AlarmCondition;
  threshold: number;
  dead_band: number;
  duration_seconds: number;
  severity: AlarmSeverity;
  enabled: boolean;
}

interface Reading {
  scada_asset_id: string;
  project_id: string;
  metric: string;
  value: number;
  ts: string; // ISO
}

/**
 * Evaluate the given `readings` against the company's enabled alarm rules.
 * Raises new alarms when a rule breaches (deduped per rule+asset), and
 * clears an active alarm when its value retreats past threshold ∓ dead_band.
 */
export async function evaluateAlarmRules(
  admin: SupabaseClient,
  companyId: string,
  readings: Reading[],
): Promise<{ raised: number; cleared: number; skipped: number }> {
  if (!readings.length) return { raised: 0, cleared: 0, skipped: 0 };

  const { data: ruleRows, error: rulesErr } = await admin
    .from("alarm_rules")
    .select(
      "id, company_id, project_id, name, metric, condition, threshold, dead_band, duration_seconds, severity, enabled",
    )
    .eq("company_id", companyId)
    .eq("enabled", true);
  if (rulesErr || !ruleRows?.length) return { raised: 0, cleared: 0, skipped: 0 };

  const rules = ruleRows as RuleRow[];
  // Group readings by (asset, metric) — evaluate against latest value.
  type Key = string;
  const latest = new Map<Key, Reading>();
  for (const r of readings) {
    const k = `${r.scada_asset_id}::${r.metric}`;
    const prev = latest.get(k);
    if (!prev || Date.parse(r.ts) > Date.parse(prev.ts)) latest.set(k, r);
  }

  // Load existing active alarms for the assets in play, so we can dedupe/clear.
  const assetIds = Array.from(new Set(readings.map((r) => r.scada_asset_id)));
  const { data: activeRows } = await admin
    .from("scada_alarms")
    .select("id, rule_id, scada_asset_id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .in("scada_asset_id", assetIds);
  const activeMap = new Map<string, string>(); // `${rule_id}::${asset_id}` -> alarm.id
  for (const a of (activeRows ?? []) as {
    id: string;
    rule_id: string | null;
    scada_asset_id: string | null;
  }[]) {
    if (a.rule_id && a.scada_asset_id) {
      activeMap.set(`${a.rule_id}::${a.scada_asset_id}`, a.id);
    }
  }

  const toRaise: Array<{
    company_id: string;
    project_id: string;
    scada_asset_id: string;
    rule_id: string;
    severity: AlarmSeverity;
    message: string;
    value: number;
    status: "active";
    raised_at: string;
  }> = [];
  const toClear: string[] = [];
  let skipped = 0;

  for (const rule of rules) {
    for (const reading of latest.values()) {
      if (reading.metric !== rule.metric) continue;
      if (rule.project_id && rule.project_id !== reading.project_id) continue;

      const key = `${rule.id}::${reading.scada_asset_id}`;
      const existingId = activeMap.get(key);
      const breaches = evaluateCondition(rule.condition, reading.value, rule.threshold);

      if (breaches && !existingId) {
        // Best-effort duration guard: require prior samples within window
        // to also breach. Zero duration or no history => raise immediately.
        if (rule.duration_seconds > 0) {
          const windowStart = new Date(
            Date.parse(reading.ts) - rule.duration_seconds * 1000,
          ).toISOString();
          const { data: history } = await admin
            .from("scada_telemetry")
            .select("value")
            .eq("scada_asset_id", reading.scada_asset_id)
            .eq("metric", reading.metric)
            .gte("ts", windowStart)
            .lt("ts", reading.ts)
            .limit(20);
          const rows = (history ?? []) as { value: number }[];
          const allBreach = rows.every((h) =>
            evaluateCondition(rule.condition, Number(h.value), rule.threshold),
          );
          if (rows.length === 0 || !allBreach) {
            skipped++;
            continue;
          }
        }
        toRaise.push({
          company_id: companyId,
          project_id: reading.project_id,
          scada_asset_id: reading.scada_asset_id,
          rule_id: rule.id,
          severity: rule.severity,
          message: `${rule.name}: ${rule.metric} ${rule.condition} ${rule.threshold} (value=${reading.value})`,
          value: reading.value,
          status: "active",
          raised_at: reading.ts,
        });
        activeMap.set(key, "pending"); // block duplicates within this batch
      } else if (
        existingId &&
        existingId !== "pending" &&
        hasCleared(rule.condition, reading.value, rule.threshold, rule.dead_band)
      ) {
        toClear.push(existingId);
      }
    }
  }

  let raised = 0;
  if (toRaise.length) {
    const { data: inserted, error, count } = await admin
      .from("scada_alarms")
      .insert(toRaise as never, { count: "exact" })
      .select("id, project_id, scada_asset_id, severity, message");
    if (!error) {
      raised = count ?? toRaise.length;
      // P-188 — digital thread: each newly raised alarm fans out to O&M areas
      // as a recommendation-only impact assessment.
      const { emitThreadEvent } = await import("@/lib/digital-thread/engine.server");
      for (const a of (inserted ?? []) as Array<{
        id: string;
        project_id: string;
        scada_asset_id: string | null;
        severity: string;
        message: string;
      }>) {
        try {
          await emitThreadEvent(
            { supabase: admin as never },
            {
              event: "scada_alarm_raised",
              sourceType: "scada_alarm",
              sourceId: a.id,
              projectId: a.project_id,
              payload: {
                scadaAssetId: a.scada_asset_id,
                severity: a.severity,
                summary: a.message,
              },
            },
          );
        } catch {
          // The thread is advisory: a failure here must never block ingestion.
        }
      }
    }
  }
  let cleared = 0;
  if (toClear.length) {
    const { error, count } = await admin
      .from("scada_alarms")
      .update({ status: "cleared", cleared_at: new Date().toISOString() } as never, {
        count: "exact",
      })
      .in("id", toClear)
      .eq("status", "active");
    if (!error) cleared = count ?? toClear.length;
  }
  return { raised, cleared, skipped };
}
