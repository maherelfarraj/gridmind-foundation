// P-191 — Amber "under change control" banner shown on frozen record headers.
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { useUnderChangeControl } from "@/hooks/use-change-control";

interface Props {
  entityType: string | null | undefined;
  entityId: string | null | undefined;
  className?: string;
}

export function UnderChangeControlBanner({ entityType, entityId, className }: Props) {
  const { blocked, changes } = useUnderChangeControl(entityType, entityId);
  if (!blocked) return null;

  const first = changes[0];
  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-2 rounded-md bg-accent/15 px-3 py-2 text-sm text-accent ${className ?? ""}`}
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">
          Under change control{first ? ` — ${first.cr_number} ${first.status}` : ""}
        </p>
        {changes.length > 0 ? (
          <ul className="space-y-0.5">
            {changes.map((cr) => (
              <li key={cr.id}>
                <Link
                  to="/changes/$id"
                  params={{ id: cr.id }}
                  className="underline underline-offset-2"
                >
                  {cr.cr_number}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {cr.title} · {cr.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            An open change request freezes this record until implementation closes.
          </p>
        )}
      </div>
    </div>
  );
}
