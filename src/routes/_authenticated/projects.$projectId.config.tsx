// P-038 — Config tab placeholder. Archetype config forms ship in P-039.
import { createFileRoute } from "@tanstack/react-router";

import { Card } from "@/components/ui/card";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/config",
)({
  component: ConfigTab,
});

function ConfigTab() {
  return (
    <Card className="border-border bg-card p-6">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Archetype configuration
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        This module ships in P-039 (archetype config forms).
      </p>
    </Card>
  );
}
