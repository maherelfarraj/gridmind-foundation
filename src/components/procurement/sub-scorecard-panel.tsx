// P-260 — Subcontractor scorecard panel (internal lens: full component scores).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/locale-provider";
import { listSubScorecards } from "@/lib/sub-compliance.functions";
import { subScorecardsQueryOptions, useComputeSubScorecard } from "@/lib/sub-compliance-query";
import { scoreTrend, todayIso } from "@/lib/sub-compliance.rules";

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

export function SubScorecardPanel({ vendorId, canWrite }: { vendorId: string; canWrite: boolean }) {
  const { t } = useI18n();
  const listFn = useServerFn(listSubScorecards);
  const { data: cards = [] } = useQuery(subScorecardsQueryOptions(listFn, vendorId));
  const [period] = useState(() => ({ start: monthStart(todayIso()), end: todayIso() }));
  const compute = useComputeSubScorecard();

  const current = cards[0] ?? null;
  const prior = cards[1] ?? null;
  const trend = scoreTrend(current?.composite ?? null, prior?.composite ?? null);

  const rows: { key: string; value: number | null }[] = [
    { key: "claimAccuracy", value: current?.claim_accuracy ?? null },
    { key: "safety", value: current?.safety_score ?? null },
    { key: "quality", value: current?.quality_score ?? null },
    { key: "onTime", value: current?.on_time_score ?? null },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          {t("procurementMod.subcontracts.scorecard.title")}
        </CardTitle>
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={compute.isPending}
            onClick={() =>
              compute.mutate({
                vendor_id: vendorId,
                period_start: period.start,
                period_end: period.end,
              })
            }
          >
            <RefreshCw className="size-4" aria-hidden />
            {t("procurementMod.subcontracts.scorecard.recompute")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!current ? (
          <EmptyState
            title={t("procurementMod.subcontracts.scorecard.empty")}
            description={t("procurementMod.subcontracts.scorecard.emptyHint")}
          />
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-3xl">{current.composite ?? "—"}</span>
              <span className="text-sm text-muted-foreground">
                {t("procurementMod.subcontracts.scorecard.composite")}
              </span>
              {trend && trend.direction !== "flat" ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {trend.direction === "up" ? (
                    <TrendingUp className="size-3.5" aria-hidden />
                  ) : (
                    <TrendingDown className="size-3.5" aria-hidden />
                  )}
                  {trend.delta > 0 ? `+${trend.delta}` : trend.delta}
                </span>
              ) : null}
            </div>
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t(`procurementMod.subcontracts.scorecard.${r.key}`)}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.value ?? "—"}
                    </span>
                  </div>
                  <Progress value={r.value ?? 0} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("procurementMod.subcontracts.scorecard.period", {
                start: current.period_start,
                end: current.period_end,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
