import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TENDER_EVENT_TYPES,
  type TenderEventRow,
  type TenderEventType,
} from "@/lib/opportunity.functions";
import { useSaveTenderEvent } from "@/lib/opportunity-query";

const TYPE_LABEL: Record<TenderEventType, string> = {
  pre_bid_meeting: "Pre-bid meeting",
  site_visit: "Site visit",
  qa_deadline: "Q&A deadline",
  submission_deadline: "Submission deadline",
  bid_opening: "Bid opening",
  clarification: "Clarification",
  award_announcement: "Award announcement",
  other: "Other",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  existing?: TenderEventRow | null;
}

function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function TenderEventDialog({ open, onOpenChange, opportunityId, existing }: Props) {
  const save = useSaveTenderEvent(opportunityId);
  const [form, setForm] = useState({
    event_type: "pre_bid_meeting" as TenderEventType,
    title: "",
    event_at: "",
    location: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm({
        event_type: existing?.event_type ?? "pre_bid_meeting",
        title: existing?.title ?? "",
        event_at: toLocalInput(existing?.event_at),
        location: existing?.location ?? "",
        notes: existing?.notes ?? "",
      });
    }
  }, [open, existing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError("Title is required");
    if (!form.event_at) return setError("Date is required");
    await save.mutateAsync({
      id: existing?.id,
      event_type: form.event_type,
      title: form.title.trim(),
      event_at: new Date(form.event_at).toISOString(),
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit tender event" : "Add tender event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.event_type}
                onValueChange={(v) => setForm({ ...form, event_type: v as TenderEventType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENDER_EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="te-when">When</Label>
              <Input
                id="te-when"
                type="datetime-local"
                value={form.event_at}
                onChange={(e) => setForm({ ...form, event_at: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-title">Title</Label>
            <Input
              id="te-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-loc">Location</Label>
            <Input
              id="te-loc"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-notes">Notes</Label>
            <Textarea
              id="te-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { TYPE_LABEL as TENDER_TYPE_LABELS };
