import { formatDistanceToNowStrict, format, parseISO } from "date-fns";
import { useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  FileText,
  MessageSquare,
  PenLine,
  UserPlus,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/lib/opportunity.functions";
import { usePostNote } from "@/lib/opportunity-query";

interface Props {
  opportunityId: string;
  items: ActivityItem[] | undefined;
  isLoading: boolean;
  canWrite: boolean;
}

export function ActivityTimeline({
  opportunityId,
  items,
  isLoading,
  canWrite,
}: Props) {
  const post = usePostNote(opportunityId);
  const [body, setBody] = useState("");

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    await post.mutateAsync(trimmed);
    setBody("");
  };

  return (
    <Card className="flex flex-col gap-3 border-border bg-card p-5">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground">
            Activity
          </h2>
          <p className="text-xs text-muted-foreground">
            Every change on this opportunity — from the audit log
          </p>
        </div>
      </header>

      {canWrite && (
        <form onSubmit={submitNote} className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Add a note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{body.length}/2000</span>
            <Button
              type="submit"
              size="sm"
              disabled={!body.trim() || post.isPending}
            >
              Post note
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-xs text-muted-foreground">
          Nothing yet. Every edit, contact, tender event, and note lands here.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-4">
          {items.map((it) => (
            <TimelineRow key={it.id} item={it} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function TimelineRow({ item }: { item: ActivityItem }) {
  const { Icon, tone } = iconFor(item);
  const when = safeDate(item.at);
  const actorName =
    item.actor?.full_name || item.actor?.email || "system";
  const initials = (actorName || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-[26px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card",
          tone,
        )}
      >
        <Icon size={11} aria-hidden />
      </span>
      <div className="flex items-start gap-2">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium text-foreground">
              {actorName}
            </span>
            <span className="text-xs text-muted-foreground">
              {item.kind === "audit" && item.action === "opportunity.note"
                ? "posted a note"
                : item.label}
            </span>
            {when && (
              <span
                className="text-[11px] text-muted-foreground"
                title={format(when, "PPpp")}
              >
                · {formatDistanceToNowStrict(when, { addSuffix: true })}
              </span>
            )}
          </div>
          {item.kind === "audit" && item.action === "opportunity.note" && (
            <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-sm text-foreground">
              {item.meta?.body}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function safeDate(iso: string): Date | null {
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function iconFor(item: ActivityItem): { Icon: typeof Activity; tone: string } {
  if (item.kind === "tender") {
    return { Icon: CalendarClock, tone: "text-muted-foreground" };
  }
  if (item.kind === "proposal") {
    return { Icon: FileText, tone: "text-muted-foreground" };
  }
  switch (item.action) {
    case "opportunity.created":
    case "lead.converted":
      return { Icon: UserPlus, tone: "text-primary" };
    case "opportunity.note":
      return { Icon: MessageSquare, tone: "text-primary" };
    case "opportunity.stage_changed":
      if (item.meta?.to === "won") return { Icon: CheckCircle2, tone: "text-primary" };
      return { Icon: Activity, tone: "text-muted-foreground" };
    case "opportunity.updated":
    case "contact.saved":
    case "tender_event.saved":
      return { Icon: PenLine, tone: "text-muted-foreground" };
    default:
      return { Icon: Activity, tone: "text-muted-foreground" };
  }
}
