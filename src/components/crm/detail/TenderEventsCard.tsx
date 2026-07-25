import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { useEffect, useState } from "react";
import {
  AlarmClock,
  CalendarClock,
  ClipboardCheck,
  FileQuestion,
  Gavel,
  MapPin,
  Megaphone,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";

import { TENDER_TYPE_LABELS, TenderEventDialog } from "@/components/crm/detail/TenderEventDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TenderEventRow, TenderEventType } from "@/lib/opportunity.functions";
import { useDeleteTenderEvent } from "@/lib/opportunity-query";

const ICONS: Record<TenderEventType, typeof AlarmClock> = {
  pre_bid_meeting: MessageSquare,
  site_visit: MapPin,
  qa_deadline: FileQuestion,
  submission_deadline: ClipboardCheck,
  bid_opening: Gavel,
  clarification: FileQuestion,
  award_announcement: Megaphone,
  other: CalendarClock,
};

interface Props {
  opportunityId: string;
  events: TenderEventRow[] | undefined;
  isLoading: boolean;
  canWrite: boolean;
  canDelete: boolean;
  openTrigger?: number; // parent-provided trigger to open dialog
  onOpenConsumed?: () => void;
}

export function TenderEventsCard({
  opportunityId,
  events,
  isLoading,
  canWrite,
  canDelete,
  openTrigger,
  onOpenConsumed,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TenderEventRow | null>(null);
  const del = useDeleteTenderEvent(opportunityId);

  useEffect(() => {
    if (openTrigger && canWrite) {
      setEditing(null);
      setOpen(true);
      onOpenConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrigger]);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (t: TenderEventRow) => {
    setEditing(t);
    setOpen(true);
  };

  const now = Date.now();

  return (
    <Card className="flex flex-col gap-3 p-5">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground">Tender events</h2>
          <p className="text-xs text-muted-foreground">
            Meetings, Q&A cut-offs, submission deadlines
          </p>
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={openNew}>
            <Plus size={14} aria-hidden />
            Add
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !events || events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No tender events scheduled
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((t) => {
            const Icon = ICONS[t.event_type] ?? CalendarClock;
            const at = new Date(t.event_at);
            const isPast = at.getTime() < now;
            const isOverdue = isPast && !t.reminder_sent_at;
            return (
              <li
                key={t.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border bg-background p-3",
                  isOverdue && "border-destructive/40",
                )}
              >
                <Icon
                  size={16}
                  aria-hidden
                  className={cn(
                    "mt-0.5 shrink-0",
                    isOverdue ? "text-destructive" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => canWrite && openEdit(t)}
                      className={cn(
                        "truncate text-sm font-medium disabled:cursor-default",
                        isOverdue ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {t.title}
                    </button>
                    <Badge variant="secondary" className="text-[10px]">
                      {TENDER_TYPE_LABELS[t.event_type]}
                    </Badge>
                    {isPast ? (
                      isOverdue ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Overdue
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Past
                        </Badge>
                      )
                    ) : (
                      <Badge className="text-[10px]">in {formatDistanceToNowStrict(at)}</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{format(at, "EEE, MMM d, yyyy · HH:mm")}</span>
                    {t.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} aria-hidden />
                        {t.location}
                      </span>
                    )}
                  </div>
                  {t.notes && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.notes}</p>
                  )}
                </div>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (
                        typeof window !== "undefined" &&
                        window.confirm(`Delete event "${t.title}"?`)
                      ) {
                        del.mutate(t.id);
                      }
                    }}
                    aria-label={`Delete ${t.title}`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TenderEventDialog
        open={open}
        onOpenChange={setOpen}
        opportunityId={opportunityId}
        existing={editing}
      />
    </Card>
  );
}

export { parseISO }; // keep tree-shakeable date-fns wiring
