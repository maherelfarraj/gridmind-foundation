// P-035 — Branded error panel with retry, extracted from step 1.
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function WizardErrorPanel({ title, message, onRetry }: Props) {
  return (
    <Card className="flex flex-col gap-4 border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-destructive">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <div className="font-medium text-foreground">{title}</div>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <div>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Card>
  );
}
