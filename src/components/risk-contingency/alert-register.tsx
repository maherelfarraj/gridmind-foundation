// GC-17 — shared risk & contingency alert register.
// Used by both the project cockpit and the portfolio dashboard so the register,
// its lifecycle actions and its accessibility behaviour are identical.
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";


import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import { snoozeUntil, type AlertStatus } from "@/lib/risk-sim.rules";

const K = "financeMod.costing.riskContingency";

export interface AlertRegisterRow {
  id: string;
  project_id: string | null;
  family: string;
  severity: string;
  status: AlertStatus;
  title: string;
  detail: string | null;
  owner_id: string | null;
  due_date: string | null;
  snoozed_until: string | null;
  row_version: number;
}

export interface AlertDecision {
  id: string;
  target: AlertStatus;
  row_version: number;
  snoozed_until?: string | null;
  escalate?: boolean;
}

export function AlertRegister({
  alerts,
  canWrite,
  busy = false,
  onDecide,
  showProject = false,
  now,
}: {
  alerts: AlertRegisterRow[];
  canWrite: boolean;
  busy?: boolean;
  onDecide: (decision: AlertDecision) => void;
  showProject?: boolean;
  now?: Date;
}) {
  const { t } = useI18n();
  // A governed action unmounts the control that triggered it (Acknowledge
  // disappears once the alert is acknowledged), which would drop focus onto
  // <body>. Keep focus in the acting row's action group instead.
  const groups = useRef(new Map<string, HTMLDivElement | null>());
  const lastActed = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = lastActed.current;
    if (!id) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName !== "HTML") return;
    const group = groups.current.get(id);
    if (!group) return;
    const next = group.querySelector<HTMLElement>("button:not([disabled])") ?? group;
    next.focus();
    lastActed.current = null;
  }, [alerts, busy]);

  const decide = (decision: AlertDecision) => {
    lastActed.current = decision.id;
    onDecide(decision);
  };

  if (alerts.length === 0) {
    return <EmptyState title={t(`${K}.alerts.title`)} description={t(`${K}.alerts.empty`)} />;
  }
  return (
    <Table>
      <caption className="sr-only">{t(`${K}.alerts.title`)}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.alerts.family`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.alert`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.severity`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.status`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.owner`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.due`)}</TableHead>
          <TableHead scope="col">{t(`${K}.alerts.actions`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((a) => (
          <TableRow key={a.id}>
            <TableCell>{t(`${K}.families.${a.family}`)}</TableCell>
            <TableCell>
              {showProject && a.project_id ? (
                <Link
                  className="underline underline-offset-2"
                  to="/projects/$projectId/costing/risk-contingency"
                  params={{ projectId: a.project_id }}
                  aria-label={`${t(`${K}.alerts.evidence`)}: ${a.title}`}
                >
                  {a.title}
                </Link>
              ) : (
                a.title
              )}
              {a.detail ? (
                <span className="block text-xs text-muted-foreground">{a.detail}</span>
              ) : null}
            </TableCell>
            <TableCell>
              <StatusBadge status={a.severity} />
            </TableCell>
            <TableCell>
              <StatusBadge status={a.status} />
            </TableCell>
            <TableCell>
              {a.owner_id ? a.owner_id.slice(0, 8) : t(`${K}.alerts.unassigned`)}
            </TableCell>
            <TableCell>{a.due_date ?? a.snoozed_until ?? "—"}</TableCell>
            <TableCell>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {a.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        onDecide({ id: a.id, target: "acknowledged", row_version: a.row_version })
                      }
                    >
                      {t(`${K}.alerts.acknowledge`)}
                    </Button>
                  ) : null}
                  {a.status === "snoozed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        onDecide({
                          id: a.id,
                          target: "open",
                          row_version: a.row_version,
                          snoozed_until: null,
                        })
                      }
                    >
                      {t(`${K}.alerts.unsnooze`)}
                    </Button>
                  ) : a.status !== "resolved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        onDecide({
                          id: a.id,
                          target: "snoozed",
                          row_version: a.row_version,
                          snoozed_until: snoozeUntil(now ?? new Date()),
                        })
                      }
                    >
                      {t(`${K}.alerts.snooze`)}
                    </Button>
                  ) : null}
                  {a.severity !== "critical" && a.status !== "resolved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        onDecide({
                          id: a.id,
                          target: a.status,
                          row_version: a.row_version,
                          escalate: true,
                        })
                      }
                    >
                      {t(`${K}.alerts.escalate`)}
                    </Button>
                  ) : null}
                  {a.status === "resolved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        onDecide({ id: a.id, target: "open", row_version: a.row_version })
                      }
                    >
                      {t(`${K}.alerts.reopen`)}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        onDecide({ id: a.id, target: "resolved", row_version: a.row_version })
                      }
                    >
                      {t(`${K}.alerts.resolve`)}
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{t(`${K}.alerts.readOnly`)}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
