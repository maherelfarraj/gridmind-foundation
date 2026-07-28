// P-252 — Portfolio project card: phase chip, gate position, mini SPI/CPI,
// open punch A count. Click-through to the project detail page.
import { HardHat } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/locale-provider";
import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";
import type { PortfolioProjectCard } from "@/lib/portfolio.functions";
import { perfTone, type PerfTone } from "@/lib/portfolio/portfolio.rules";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<PerfTone, string> = {
  neutral: "text-muted-foreground",
  good: "text-accent",
  warning: "text-warning",
  bad: "text-destructive",
};

function MiniIndex({ label, value }: { label: string; value: number | null }) {
  const { locale } = useI18n();
  const tone = perfTone(value);
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", TONE_TEXT[tone])}>
        {value === null ? "—" : formatNumber(value, locale, { maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}

export function ProjectCard({ project }: { project: PortfolioProjectCard }) {
  const { t, locale } = useI18n();

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold text-foreground">{project.project_name}</p>
          <p className="truncate text-xs text-muted-foreground">{project.project_code}</p>
        </div>
        <StatusBadge status={project.phase} label={t(`portfolioMod.phases.${project.phase}`)} />
      </div>

      <p className="text-sm font-medium tabular-nums text-foreground">
        {formatCurrency(Number(project.contract_value ?? 0), locale, project.currency_code)}
      </p>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t("portfolioMod.projects.currentGate")}</dt>
          <dd className="truncate text-foreground">
            {project.current_gate_name ?? t("portfolioMod.projects.noGate")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t("portfolioMod.projects.nextGate")}</dt>
          <dd className="truncate text-foreground">
            {project.next_gate_name ?? t("portfolioMod.projects.allGatesApproved")}
            {project.next_gate_due ? (
              <span className="text-muted-foreground">
                {" · "}
                {formatDate(project.next_gate_due, locale)}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-6">
          <MiniIndex label={t("portfolioMod.projects.spi")} value={project.spi} />
          <MiniIndex label={t("portfolioMod.projects.cpi")} value={project.cpi} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <HardHat className="size-3.5" aria-hidden />
          <span>{t("portfolioMod.projects.punchA")}</span>
          <span className="font-semibold tabular-nums text-foreground">{project.punch_a_open}</span>
        </div>
      </div>
    </Card>
  );
}
