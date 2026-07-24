// P-054 — Hierarchy preview card.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VoltageLevel } from "@/lib/sld.functions";

export function SldHierarchyPreview({ levels }: { levels: VoltageLevel[] }) {
  const sorted = [...levels]
    .filter((l) => Number.isFinite(l.kv) && l.kv > 0)
    .sort((a, b) => a.kv - b.kv);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Voltage hierarchy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add at least one voltage level to see the hierarchy.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {sorted.map((lvl, i) => (
              <div key={`${lvl.kv}-${i}`} className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  {lvl.kv} kV {lvl.type}
                </Badge>
                {i < sorted.length - 1 && (
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
