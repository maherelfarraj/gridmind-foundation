// P-190 — Change type badge (token classes only).
import { Badge } from "@/components/ui/badge";
import { changeTypeMeta } from "@/lib/moc.rules";
import { cn } from "@/lib/utils";

export function ChangeTypeBadge({ type, className }: { type: string; className?: string }) {
  const meta = changeTypeMeta(type);
  return (
    <Badge variant="outline" className={cn("border-transparent", meta.badgeClass, className)}>
      {meta.label}
    </Badge>
  );
}
