// P-218 — Lender indicators card: covenant-language KPIs with formula tooltips.
import { Info, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ESG_METHODOLOGY_NOTE } from "@/lib/esg/carbon";
import {
  ESG_TOOLTIP,
  NA_REASON_LABEL,
  fmtMwh,
  fmtPct,
  fmtTonnes,
  fmtTrir,
  type NaReason,
} from "@/lib/esg/dashboard.rules";

type Indicator = {
  label: string;
  value: string;
  formula: string;
  href?: string;
  note?: string;
};

export function LenderIndicatorsCard({
  grossKg,
  avoidedKg,
  renewableMwh,
  renewableSharePct,
  renewableShareReason,
  diversionPct,
  diversionReason,
  trir,
  hseAvailable,
}: {
  grossKg: number;
  avoidedKg: number | null;
  renewableMwh: number | null;
  renewableSharePct: number | null;
  renewableShareReason: NaReason | null;
  diversionPct: number | null;
  diversionReason: NaReason | null;
  trir: number | null;
  hseAvailable: boolean;
}) {
  const indicators: Indicator[] = [
    {
      label: "Total GHG emissions",
      value: fmtTonnes(grossKg),
      formula: ESG_TOOLTIP.total_ghg,
    },
    {
      label: "Avoided emissions",
      value: fmtTonnes(avoidedKg, "no_metered_data"),
      formula: ESG_TOOLTIP.avoided_t,
    },
    {
      label: "Renewable generation",
      value: fmtMwh(renewableMwh, "no_metered_data"),
      formula: ESG_TOOLTIP.renewable,
    },
    {
      label: "% renewable in portfolio",
      value: fmtPct(renewableSharePct, renewableShareReason ?? "no_metered_data"),
      formula: ESG_TOOLTIP.renewable_share,
      note:
        renewableSharePct === null
          ? renewableShareReason === "single_project"
            ? "Single project in scope — no portfolio comparison."
            : "No metered generation to compare against."
          : undefined,
    },
    {
      label: "Water usage",
      value: NA_REASON_LABEL.not_tracked,
      formula: ESG_TOOLTIP.water,
      note: "No water metric recorded in environmental monitoring yet.",
    },
    {
      label: "Waste diversion rate",
      value: fmtPct(diversionPct, diversionReason ?? "no_waste_data"),
      formula: ESG_TOOLTIP.diversion,
    },
    {
      label: "HSE TRIR",
      value: hseAvailable ? fmtTrir(trir) : NA_REASON_LABEL.table_missing,
      formula: ESG_TOOLTIP.trir,
      href: "/hse",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Lender indicators</CardTitle>
        <p className="text-muted-foreground text-xs">
          Covenant-style reportable KPIs for the selected period.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((i) => (
          <div key={i.label} className="space-y-1">
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              {i.label}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label={`${i.label} formula`}>
                    <Info className="size-3" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{i.formula}</TooltipContent>
              </Tooltip>
            </span>
            <p className="text-lg font-semibold tabular-nums">{i.value}</p>
            {i.note ? <p className="text-muted-foreground text-xs">{i.note}</p> : null}
            {i.href ? (
              <Link
                to={i.href}
                className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
              >
                View HSE <ExternalLink className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <p className="text-muted-foreground text-xs">{ESG_METHODOLOGY_NOTE}</p>
      </CardFooter>
    </Card>
  );
}
