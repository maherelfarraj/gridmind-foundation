// P-230 — Leave request dialog: type, range, live server-side day count,
// reason and optional attachment.
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { supabase } from "@/integrations/supabase/client";
import {
  attachLeaveDocument,
  createLeaveAttachmentUpload,
  requestLeave,
} from "@/lib/leave.functions";
import {
  countWorkingDays,
  describeWorkingDays,
  LEAVE_ALLOWED_MIME,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  validateLeaveFile,
  type LeaveType,
} from "@/lib/timesheets/leave";

interface Props {
  onDone: () => void;
}

export function LeaveRequestDialog({ onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LeaveType>("annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (to && from && to < from) setTo(from);
  }, [from, to]);

  // Preview only — the server always recomputes the authoritative count.
  const days = useMemo(() => (from && to ? countWorkingDays(from, to) : 0), [from, to]);

  const requestFn = useServerFn(requestLeave);
  const uploadFn = useServerFn(createLeaveAttachmentUpload);
  const attachFn = useServerFn(attachLeaveDocument);

  const submit = useMutation({
    mutationFn: async () => {
      const res = await requestFn({
        data: { leave_type: type, date_from: from, date_to: to, reason: reason || null },
      });
      if (file) {
        const target = await uploadFn({
          data: {
            leave_request_id: res.leave.id,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
          },
        });
        const up = await supabase.storage
          .from(target.bucket)
          .uploadToSignedUrl(target.path, target.token, file);
        if (up.error) throw new Error("Attachment upload failed");
        await attachFn({ data: { leave_request_id: res.leave.id, path: target.path } });
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(`${res.leave.request_number ?? "Leave request"} submitted`);
      if (res.pendingOverlapWarning) toast.warning(res.pendingOverlapWarning);
      setOpen(false);
      setFrom("");
      setTo("");
      setReason("");
      setFile(null);
      onDone();
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not submit request"),
  });

  const fileError = file ? validateLeaveFile({ size: file.size, type: file.type }) : null;
  const canSubmit = !!from && !!to && days > 0 && !fileError && !submit.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" /> Request leave
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            Weekend days are excluded automatically and the day count is confirmed on the server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select value={type} onValueChange={(v) => setType(v as LeaveType)}>
              <SelectTrigger id="leave-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LEAVE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="leave-from">From</Label>
              <Input
                id="leave-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-to">To</Label>
              <Input
                id="leave-to"
                type="date"
                min={from || undefined}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground" aria-live="polite">
            {from && to
              ? days > 0
                ? describeWorkingDays(days)
                : "That range contains no working days."
              : "Pick a start and end date."}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="leave-reason">Reason</Label>
            <Textarea
              id="leave-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional context for your approver"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="leave-file" className="flex items-center gap-1.5">
              <Paperclip className="size-3.5" /> Attachment (optional)
            </Label>
            <Input
              id="leave-file"
              type="file"
              accept={LEAVE_ALLOWED_MIME.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {fileError ? (
              <p className="text-xs text-destructive">
                {fileError === "file_too_large"
                  ? "Files must be 25 MB or smaller."
                  : "Unsupported file type."}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
