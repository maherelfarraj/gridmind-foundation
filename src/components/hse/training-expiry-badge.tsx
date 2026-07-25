// P-088 — Training expiry badge.
import { Badge } from "@/components/ui/badge";
import { trainingExpiryStatus } from "@/lib/hse.rules";

interface Props {
  expiresOn: string | null | undefined;
  now?: Date;
}

export function TrainingExpiryBadge({ expiresOn, now }: Props) {
  const status = trainingExpiryStatus(expiresOn, now);
  if (status === "expired") {
    return (
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
        Expired
      </Badge>
    );
  }
  if (status === "expiring_30") {
    return (
      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-foreground">
        Expiring ≤ 30d
      </Badge>
    );
  }
  if (status === "no_expiry") {
    return <Badge variant="secondary">No expiry</Badge>;
  }
  return <Badge variant="secondary">Valid</Badge>;
}
