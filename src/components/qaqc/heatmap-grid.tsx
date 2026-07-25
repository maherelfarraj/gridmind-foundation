import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  heatmapCellTint,
  QAQC_DISCIPLINE_LABELS,
  type HeatmapSummary,
  type QaqcDiscipline,
} from "@/lib/qaqc.rules";

interface Props {
  data: HeatmapSummary;
  onCellClick?: (area: string, discipline: QaqcDiscipline) => void;
}

export function HeatmapGrid({ data, onCellClick }: Props) {
  const { areas, disciplines, cells } = data;
  if (areas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No inspection data for this period.
      </div>
    );
  }
  return (
    <TooltipProvider delayDuration={100}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Area</th>
              {disciplines.map((d) => (
                <th key={d} className="px-3 py-2 text-center">
                  {QAQC_DISCIPLINE_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className="whitespace-nowrap px-3 py-2 text-left font-medium text-foreground"
                >
                  {area}
                </th>
                {disciplines.map((d) => {
                  const c = cells[area][d];
                  const tint = heatmapCellTint(c.failRate, c.count);
                  return (
                    <td key={d} className="p-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => c.count > 0 && onCellClick?.(area, d)}
                            disabled={c.count === 0}
                            className={cn(
                              "flex h-16 w-full flex-col items-center justify-center rounded-md border border-border text-sm transition-colors",
                              tint,
                              c.count > 0
                                ? "hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
                                : "cursor-default",
                            )}
                            aria-label={`${area} · ${QAQC_DISCIPLINE_LABELS[d]} · ${c.count} inspection(s)`}
                          >
                            <span className="font-display text-lg font-semibold tabular-nums text-foreground">
                              {c.count}
                            </span>
                            {c.count > 0 ? (
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {Math.round(c.failRate * 100)}% issues
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </button>
                        </TooltipTrigger>
                        {c.count > 0 ? (
                          <TooltipContent className="text-xs">
                            <div>
                              <b>{area}</b> · {QAQC_DISCIPLINE_LABELS[d]}
                            </div>
                            <div>Pass: {c.pass}</div>
                            <div>Fail: {c.fail}</div>
                            <div>Conditional: {c.conditional}</div>
                            <div>Pending: {c.pending}</div>
                            <div>Rework: {c.rework}</div>
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
