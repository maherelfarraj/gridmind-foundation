// P-195 — Dunning: send-reminder dialog + reminder history timeline.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { sendArReminder } from "@/lib/ar-aging.functions";
import { invoiceRemindersQueryOptions } from "@/lib/ar-aging.query";
import {
  REMINDER_CHANNELS,
  reminderChannelLabel,
  type ReminderChannel,
} from "@/lib/ar-aging.rules";
import { invoiceErrorMessage } from "@/lib/invoices.query";
import { formatDateTime } from "@/lib/format";

function defaultTemplate(invoiceNumber: string, daysPastDue: number, client: string | null) {
  const who = client ? `Dear ${client},` : "Dear client,";
  return daysPastDue > 0
    ? `${who}\n\nOur records show invoice ${invoiceNumber} is ${daysPastDue} day(s) past due. Kindly arrange settlement at your earliest convenience, or let us know if any documentation is outstanding on our side.\n\nKind regards,\nGridMind EPC — Finance`
    : `${who}\n\nThis is a courtesy reminder that invoice ${invoiceNumber} is approaching its due date. Please let us know if anything is required from our side to process payment on time.\n\nKind regards,\nGridMind EPC — Finance`;
}

export function ReminderHistory({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading } = useQuery(invoiceRemindersQueryOptions(invoiceId));
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No reminders sent yet.</p>;
  }
  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {rows.map((r) => (
        <li key={r.id} className="relative space-y-1">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">#{r.reminder_number}</Badge>
            <span className="text-sm font-medium text-foreground">
              {reminderChannelLabel(r.channel as ReminderChannel)}
            </span>
            <span className="text-xs text-muted-foreground">{formatDateTime(r.sent_at)}</span>
            {r.sent_by_name ? (
              <span className="text-xs text-muted-foreground">by {r.sent_by_name}</span>
            ) : null}
          </div>
          {r.template ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{r.template}</p>
          ) : null}
          {r.notes ? <p className="text-xs text-muted-foreground">Notes: {r.notes}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function SendReminderDialog({
  invoiceId,
  invoiceNumber,
  clientName,
  daysPastDue,
  disabled,
}: {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string | null;
  daysPastDue: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ReminderChannel>("email");
  const [template, setTemplate] = useState(() =>
    defaultTemplate(invoiceNumber, daysPastDue, clientName),
  );
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();
  const send = useServerFn(sendArReminder);

  const mutation = useMutation({
    mutationFn: () =>
      send({
        data: { invoice_id: invoiceId, channel, template, notes: notes.trim() || undefined },
      }),
    onSuccess: () => {
      toast.success(`Reminder logged for ${invoiceNumber}`);
      void qc.invalidateQueries({ queryKey: ["ar-reminders", invoiceId] });
      void qc.invalidateQueries({ queryKey: ["ar-aging"] });
      setNotes("");
      setOpen(false);
    },
    onError: (e) => toast.error(invoiceErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Send className="size-4" /> Remind
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send reminder — {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Logged against the invoice with a sequential reminder number and full audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reminder-channel">Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as ReminderChannel)}>
              <SelectTrigger id="reminder-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {reminderChannelLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reminder-template">Message</Label>
            <Textarea
              id="reminder-template"
              rows={7}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reminder-notes">Internal notes (optional)</Label>
            <Textarea
              id="reminder-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <History className="size-3.5" /> History
            </p>
            <ReminderHistory invoiceId={invoiceId} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || template.trim().length < 3}
          >
            {mutation.isPending ? "Sending…" : "Log reminder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
