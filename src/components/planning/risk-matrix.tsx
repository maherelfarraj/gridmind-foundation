// P-074 — 5×5 probability × impact heat matrix.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RiskRow } from "@/lib/risks.functions";
import { heatCellClass, IMPACT_LABELS, matrixCells, PROBABILITY_LABELS } from "@/lib/risks.rules";

interface Props {
  risks: RiskRow[];
  onSelect: (id: string) => void;
}

export function RiskMatrix({ risks, onSelect }: Props) {
  const cells = matrixCells(risks);

  // Rows: probability high→low (5 at top). Cols: impact low→high (1 at left).
  const probabilities = [5, 4, 3, 2, 1];
  const impacts = [1, 2, 3, 4, 5];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))_auto] gap-1">
          <div />
          {impacts.map((i) => (
            <div
              key={`ih-${i}`}
              className="pb-2 text-center text-xs font-medium text-muted-foreground"
            >
              {IMPACT_LABELS[i]}
            </div>
          ))}
          <div />

          {probabilities.map((p) => (
            <MatrixRow
              key={`row-${p}`}
              probability={p}
              impacts={impacts}
              cells={cells}
              onSelect={onSelect}
            />
          ))}

          <div />
          <div className="col-span-5 pt-2 text-center text-xs font-medium text-muted-foreground">
            Impact →
          </div>
          <div />
        </div>
      </div>
    </div>
  );
}

function MatrixRow({
  probability,
  impacts,
  cells,
  onSelect,
}: {
  probability: number;
  impacts: number[];
  cells: Map<string, RiskRow[]>;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="flex items-center pr-2 text-right text-xs font-medium text-muted-foreground">
        {PROBABILITY_LABELS[probability]}
      </div>
      {impacts.map((impact) => {
        const key = `${probability}-${impact}`;
        const items = cells.get(key) ?? [];
        return (
          <div
            key={key}
            className={cn(
              "flex min-h-[92px] flex-col gap-1 rounded-md border border-border/60 p-2",
              heatCellClass(probability, impact),
            )}
          >
            {items.length === 0 ? (
              <span className="m-auto text-xs text-muted-foreground/60">·</span>
            ) : (
              items.map((r) => (
                <TooltipProvider key={r.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect(r.id)}
                        className="truncate rounded border border-border bg-card px-2 py-1 text-left text-xs text-foreground shadow-sm hover:border-primary"
                      >
                        {r.title}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {r.title} · P{r.probability}×I{r.impact} = {r.score}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))
            )}
          </div>
        );
      })}
      <div className="flex items-center pl-2 text-left text-xs font-medium text-muted-foreground">
        {probability === 3 ? "↑ Probability" : ""}
      </div>
    </>
  );
}
