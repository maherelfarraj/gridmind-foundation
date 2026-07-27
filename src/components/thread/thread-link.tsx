// P-188 — Deep link from any module surface into the digital thread viewer.
import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";

import { cn } from "@/lib/utils";

export function ThreadLink({
  entityType,
  entityId,
  label = "View thread",
  className,
}: {
  entityType: string;
  entityId: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      to="/thread/$entityType/$entityId"
      params={{ entityType, entityId }}
      search={{ depth: 2 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <Network className="size-3.5" />
      {label}
    </Link>
  );
}
