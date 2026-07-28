// P-241 — numeric/money cells stay LTR and tabular inside an RTL flow, and keep
// end-alignment so money columns line up in both directions.
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("inline-block tabular-nums", className)}>
      {children}
    </span>
  );
}

export function MoneyCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("block text-end font-mono text-sm tabular-nums", className)}>
      {children}
    </span>
  );
}
