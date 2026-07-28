// P-252 — Portfolio gate rail: one horizontal Development→NTP→COD→Handover
// track per project, RTL-safe (logical flex order follows document direction).
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { PortfolioProjectCard } from "@/lib/portfolio.functions";
import { PHASE_RAIL, railIndex } from "@/lib/portfolio/portfolio.rules";
import { cn } from "@/lib/utils";

export function GateRail({ projects }: { projects: PortfolioProjectCard[] }) {
  const { t } = useI18n();

  return (
    <Card className="space-y-4 p-4">
      <SectionHeader
        title={t("portfolioMod.gateRail.heading")}
        description={t("portfolioMod.gateRail.description")}
      />
      <div className="space-y-4">
        {projects.map((project) => {
          const reached = railIndex(project.phase);
          return (
            <div key={project.project_id} className="space-y-2">
              <p className="truncate text-sm font-medium text-foreground">
                {project.project_code} — {project.project_name}
              </p>
              <ol className="flex items-center gap-2" aria-label={project.project_code}>
                {PHASE_RAIL.map((phase, index) => {
                  const done = index <= reached;
                  return (
                    <li key={phase} className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        aria-current={index === reached ? "step" : undefined}
                        className={cn(
                          "grid size-3 shrink-0 place-items-center rounded-full",
                          done ? "bg-primary" : "bg-muted",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate text-xs",
                          done ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {t(`portfolioMod.phases.${phase}`)}
                      </span>
                      {index < PHASE_RAIL.length - 1 ? (
                        <span
                          aria-hidden
                          className={cn(
                            "h-px min-w-4 flex-1",
                            index < reached ? "bg-primary" : "bg-border",
                          )}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
