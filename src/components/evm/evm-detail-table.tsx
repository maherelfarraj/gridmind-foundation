// GC-12 — WBS/CBS EVM detail with drill-down and deterministic ordering.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, percent, ratio } from "@/components/evm/evm-format";
import type { EvmNode } from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";
import { cn } from "@/lib/utils";

const K = "financeMod.costing.evm";

export function EvmDetailTable({
  nodes,
  currency,
  onDrill,
}: {
  nodes: EvmNode[];
  currency: string;
  onDrill?: (node: EvmNode) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const hidden = new Set<string>();
  for (const n of nodes) {
    if (n.parent_key && (collapsed.has(n.parent_key) || hidden.has(n.parent_key))) {
      hidden.add(n.key);
    }
  }
  const visible = nodes.filter((n) => !hidden.has(n.key));
  const hasChildren = (key: string) => nodes.some((n) => n.parent_key === key);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (nodes.length === 0) {
    return <EmptyState title={t(`${K}.detail.emptyTitle`)} description={t(`${K}.detail.emptyBody`)} />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{t(`${K}.detail.caption`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.detail.scope`)}</TableHead>
            <TableHead scope="col">{t(`${K}.detail.method`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.detail.allocation`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.detail.progress`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.bac`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.pv`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ev`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ac`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.cpi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.spi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.eac`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.vac`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((n) => {
            const expandable = hasChildren(n.key);
            return (
              <TableRow key={n.key}>
                <TableCell style={{ paddingInlineStart: `${0.5 + n.level * 1}rem` }}>
                  <div className="flex items-center gap-2">
                    {expandable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1 text-xs"
                        aria-expanded={!collapsed.has(n.key)}
                        onClick={() => toggle(n.key)}
                      >
                        {collapsed.has(n.key) ? "+" : "−"}
                        <span className="sr-only">{t(`${K}.detail.toggle`, { scope: n.label })}</span>
                      </Button>
                    ) : (
                      <span className="inline-block w-6" aria-hidden="true" />
                    )}
                    {onDrill ? (
                      <button
                        type="button"
                        className="text-start text-foreground underline-offset-2 hover:underline"
                        onClick={() => onDrill(n)}
                      >
                        {n.label}
                      </button>
                    ) : (
                      <span className={cn(n.level === 0 && "font-medium text-foreground")}>{n.label}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t(`${K}.progressMethod.${n.progress_method}`)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{percent(n.allocation_pct)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {percent(n.applied_pct)}
                  {n.overridden ? (
                    <span className="ms-1 text-xs text-warning">{t(`${K}.detail.overridden`)}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.bac, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.pv, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.ev, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.ac, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(n.measures.cpi)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(n.measures.spi)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.eac, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(n.measures.vac, currency)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
