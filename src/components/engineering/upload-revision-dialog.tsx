// P-053 — Upload revision dialog (XHR with progress → register).
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload } from "lucide-react";

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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  DRAWING_ALLOWED_EXTENSIONS,
  DRAWING_MAX_BYTES,
} from "@/lib/drawings.functions";
import {
  useGetRevisionUploadUrl,
  useRegisterDrawingRevision,
} from "@/lib/drawings-query";

const schema = z.object({
  revisionCode: z.string().trim().min(1).max(10),
  issueReason: z.string().trim().max(500).optional(),
});
type FormValues = z.infer<typeof schema>;

function extAllowed(name: string): boolean {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return false;
  return (DRAWING_ALLOWED_EXTENSIONS as readonly string[]).includes(
    name.slice(idx).toLowerCase(),
  );
}

async function xhrPut(url: string, file: File, onProgress: (pct: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

interface Props {
  drawingId: string;
  projectId: string;
  disabled?: boolean;
}

export function UploadRevisionDialog({ drawingId, projectId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "signing" | "uploading" | "registering">("idle");
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sign = useGetRevisionUploadUrl();
  const register = useRegisterDrawingRevision(drawingId, projectId);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { revisionCode: "", issueReason: "" },
  });

  const onFilePicked = async (f: File | null) => {
    setError(null);
    setFile(f);
    setSuggested(null);
    if (!f) return;
    if (!extAllowed(f.name)) {
      setError(
        `File type not allowed. Use: ${DRAWING_ALLOWED_EXTENSIONS.join(", ")}`,
      );
      return;
    }
    if (f.size > DRAWING_MAX_BYTES) {
      setError("File exceeds 50 MB limit.");
      return;
    }
    // Ask server for suggested revision code
    try {
      setPhase("signing");
      const res = await sign.mutateAsync({
        drawingId,
        fileName: f.name,
        fileSize: f.size,
        mimeType: f.type || null,
      });
      setSuggested(res.suggestedRevisionCode);
      form.setValue("revisionCode", res.suggestedRevisionCode);
      // Cache signed URL on the sign mutation state; we'll resign on submit to be safe.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to prepare upload");
    } finally {
      setPhase("idle");
    }
  };

  const reset = () => {
    setFile(null);
    setProgress(0);
    setError(null);
    setPhase("idle");
    setSuggested(null);
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
  };

  const onSubmit = async (values: FormValues) => {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    setError(null);
    try {
      setPhase("signing");
      const signed = await sign.mutateAsync({
        drawingId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || null,
      });
      setPhase("uploading");
      await xhrPut(signed.signedUrl, file, setProgress);
      setPhase("registering");
      await register.mutateAsync({
        revisionCode: values.revisionCode,
        storagePath: signed.path,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || null,
        issueReason: values.issueReason || null,
      });
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Upload size={14} aria-hidden />
          Upload revision
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload revision</DialogTitle>
          <DialogDescription>
            Uploads land as draft in the drawings bucket. Revision codes must be unique per
            drawing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="revision-file">Drawing file</Label>
            <Input
              ref={fileRef}
              id="revision-file"
              type="file"
              accept={DRAWING_ALLOWED_EXTENSIONS.join(",")}
              onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="revision-code">Revision code</Label>
              <Input
                id="revision-code"
                placeholder="A"
                {...form.register("revisionCode")}
              />
              {suggested && (
                <p className="text-xs text-muted-foreground">
                  Suggested: <span className="font-mono">{suggested}</span>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="issue-reason">Issue reason (optional)</Label>
              <Input
                id="issue-reason"
                placeholder="Initial issue"
                {...form.register("issueReason")}
              />
            </div>
          </div>
          {phase === "uploading" && (
            <div className="flex flex-col gap-1">
              <Progress value={progress} />
              <span className="text-xs text-muted-foreground">Uploading {progress}%</span>
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !file}>
              {busy && <Loader2 className="animate-spin" size={14} />}
              {phase === "uploading"
                ? "Uploading…"
                : phase === "registering"
                  ? "Saving…"
                  : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
