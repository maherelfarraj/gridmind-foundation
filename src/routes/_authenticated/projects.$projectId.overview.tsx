// P-038 / POL-5 — Overview tab: lender-ready KPI strip + key facts + team.
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  MessageSquareWarning,
  Milestone,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { KpiTile } from "@/components/ui/kpi-tile";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import { projectOverviewKpisQueryOptions } from "@/lib/project-overview-query";

export const Route = createFileRoute("/_authenticated/projects/$projectId/overview")({
  component: OverviewTab,
});

function OverviewTab() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));
  const { data: kpis, isLoading } = useQuery(projectOverviewKpisQueryOptions(projectId));

  if (!project) return null;

  const capacity =
    project.capacity_mw != null
      ? `${formatNumber(Number(project.capacity_mw), { maximumFractionDigits: 1 })} MW${
          project.capacity_mwh != null
            ? ` / ${formatNumber(Number(project.capacity_mwh), { maximumFractionDigits: 1 })} MWh`
            : ""
        }`
      : "—";
  const site = [project.site_name, project.site_region, project.site_country]
    .filter(Boolean)
    .join(", ");
  const cod = formatDate(project.target_cod);

  const days = kpis?.days_to_cod ?? null;
  const readiness = kpis?.current_gate?.readiness_pct ?? 0;
  const budget = kpis?.budget ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile label="Capacity" value={capacity} hint={project.offtaker || undefined} icon={Zap} />
        <KpiTile
          label="Target COD"
          value={cod}
          hint={days == null ? undefined : days >= 0 ? `${formatNumber(days, {})} days to go` : `${formatNumber(Math.abs(days), {})} days overdue`}
          icon={CalendarClock}
          isLoading={isLoading}
          status={days != null && days < 0 ? "bad" : "neutral"}
        />
        <KpiTile
          label={kpis?.current_gate ? `${kpis.current_gate.name} gate readiness` : "Gate readiness"}
          value={`${readiness}%`}
          hint={
            kpis?.current_gate
              ? `${kpis.current_gate.phase} · ${kpis.current_gate.status.replace("_", " ")}`
              : "No active gate"
          }
          icon={ShieldCheck}
          isLoading={isLoading}
          status={readiness >= 80 ? "good" : readiness >= 40 ? "warning" : "neutral"}
        />
        <KpiTile
          label="Budget (BAC)"
          value={budget ? formatMoney(budget.bac, budget.currency_code) : "—"}
          hint={
            budget
              ? `Committed ${formatMoney(budget.committed, budget.currency_code)} · Actual ${formatMoney(
                  budget.actual,
                  budget.currency_code,
                )}`
              : "No budget baseline yet"
          }
          icon={Wallet}
          isLoading={isLoading}
          delta={
            budget ? (
              <Link to="/projects/$projectId/finance/budget" params={{ projectId }}>
                {budget.lines} lines
              </Link>
            ) : undefined
          }
        />
        <KpiTile
          label="Open risks"
          value={formatNumber(kpis?.open_risks ?? 0, {})}
          hint={
            kpis?.top_risk_score != null ? `Highest score ${kpis.top_risk_score} / 25` : "None open"
          }
          icon={AlertTriangle}
          isLoading={isLoading}
          status={(kpis?.top_risk_score ?? 0) >= 15 ? "bad" : (kpis?.open_risks ?? 0) > 0 ? "warning" : "good"}
        />
        <KpiTile
          label="Open RFIs"
          value={formatNumber(kpis?.open_rfis ?? 0, {})}
          hint={
            kpis?.next_milestone
              ? `Next: ${kpis.next_milestone.name}${
                  kpis.next_milestone.date ? ` · ${formatDate(kpis.next_milestone.date)}` : ""
                }`
              : "No upcoming milestone"
          }
          icon={kpis?.open_rfis ? MessageSquareWarning : Milestone}
          isLoading={isLoading}
          status={(kpis?.open_rfis ?? 0) > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Key facts
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Fact label="Capacity" value={capacity} />
            <Fact label="Target COD" value={cod} />
            <Fact label="Site" value={site || "—"} className="col-span-2" />
            <Fact label="Offtaker" value={project.offtaker || "—"} />
            <Fact label="Status" value={<span className="capitalize">{project.status}</span>} />
            <Fact
              label="Budget variance"
              value={budget ? formatMoney(budget.variance, budget.currency_code) : "—"}
            />
            <Fact
              label="Next milestone"
              value={kpis?.next_milestone ? kpis.next_milestone.name : "—"}
            />
          </dl>
          {project.description && (
            <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Team
          </h2>
          {project.members.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No members assigned yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {project.members.map((m) => {
                const label = m.full_name ?? m.email ?? m.user_id.slice(0, 8);
                const initials = getInitials(m.full_name, m.email);
                const isAdmin = m.user_id === project.project_admin_id;
                return (
                  <li key={m.id} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                      {initials}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">{label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.project_role.replace(/_/g, " ")}
                        {isAdmin ? " · Project admin" : ""}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function getInitials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
