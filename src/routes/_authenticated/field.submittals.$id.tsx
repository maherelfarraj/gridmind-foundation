// P-091 — Submittal detail: revisions ledger, submit, review, revise.
import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  reviewSubmittal,
  reviseSubmittal,
  signSubmittalUpload,
  submitSubmittal,
} from "@/lib/submittals.functions";
import { errorMessage, submittalDetailQueryOptions } from "@/lib/submittals-query";
import {
  REVIEW_DECISIONS,
  SUBMITTAL_STATUS_LABELS,
  submittalStatusTint,
  type ReviewDecision,
} from "@/lib/submittals.rules";

export const Route = createFileRoute("/_authenticated/field/submittals/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Submittal ${params.id.slice(0, 8)} — GridMind EPC` },
      { name: "description", content: "Submittal detail with revisions and review flow." },
      { property: "og:title", content: "Submittal detail — GridMind EPC" },
      {
        property: "og:description",
        content: "Submit, review, and revise engineering submittals with a revision ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubmittalDetailPage,
});

function SubmittalDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const query = useQuery(submittalDetailQueryOptions(id));

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseFilePath, setReviseFilePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submitMut = useMutation({
    mutationFn: () => submitSubmittal({ data: { id } }),
    onSuccess: async () => {
      toast.success("Submitted for review");
      await qc.invalidateQueries({ queryKey: ["submittals"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reviewMut = useMutation({
    mutationFn: () =>
      reviewSubmittal({
        data: { id, status: reviewDecision, reviewNotes: reviewNotes || null } as any,
      }),
    onSuccess: async () => {
      toast.success("Review recorded");
      setReviewOpen(false);
      setReviewNotes("");
      await qc.invalidateQueries({ queryKey: ["submittals"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reviseMut = useMutation({
    mutationFn: () =>
      reviseSubmittal({
        data: { id, filePath: reviseFilePath ?? null } as any,
      }),
    onSuccess: async (row) => {
      toast.success(`New revision ${(row as any).revision} created`);
      setReviseOpen(false);
      setReviseFilePath(null);
      await qc.invalidateQueries({ queryKey: ["submittals"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !query.data) return;
    setUploading(true);
    try {
      const signed = await signSubmittalUpload({
        data: {
          projectId: query.data.submittal.project_id,
          fileName: file.name,
        } as any,
      });
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) throw error;
      setReviseFilePath(signed.path);
      toast.success("File uploaded");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load submittal</AlertTitle>
          <AlertDescription>{errorMessage(query.error) || "Not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { submittal, revisions, file_url, permissions } = query.data;
  const canWrite = permissions.canWrite;
  const isDraft = submittal.status === "draft";
  const isUnderReview = submittal.status === "submitted" || submittal.status === "under_review";

  return (
    <div className="page-shell pb-24">
      <header className="flex flex-col gap-2">
        <Link
          to="/field/submittals"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to submittals
        </Link>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <FileText size={14} aria-hidden /> Submittal
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {submittal.submittal_number} · {submittal.revision}
          </h1>
          <Badge className={submittalStatusTint(submittal.status)} variant="outline">
            {SUBMITTAL_STATUS_LABELS[submittal.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{submittal.title}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Project</span>
            <div>{submittal.project_name ?? "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Spec section</span>
            <div>{submittal.spec_section ?? "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Due</span>
            <div>{submittal.due_date ?? "—"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Submitted / Reviewed</span>
            <div>
              {submittal.submitted_at ? new Date(submittal.submitted_at).toLocaleDateString() : "—"}{" "}
              / {submittal.reviewed_at ? new Date(submittal.reviewed_at).toLocaleDateString() : "—"}
            </div>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Review notes</span>
            <div className="whitespace-pre-wrap">{submittal.review_notes ?? "—"}</div>
          </div>
          <div className="col-span-2">
            {file_url ? (
              <Button size="sm" variant="outline" asChild>
                <a href={file_url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" /> Download attachment
                </a>
              </Button>
            ) : (
              <span className="text-muted-foreground">No attachment</span>
            )}
          </div>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-end gap-2">
            {isDraft ? (
              <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
                {submitMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit for review
              </Button>
            ) : null}
            {isUnderReview ? (
              <Button onClick={() => setReviewOpen(true)}>Record review</Button>
            ) : null}
            <Button variant="outline" onClick={() => setReviseOpen(true)}>
              New revision
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revisions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {revisions.map((r) => (
            <Link
              key={r.id}
              to="/field/submittals/$id"
              params={{ id: r.id }}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted ${r.id === submittal.id ? "border-primary" : "border-border"}`}
            >
              <span className="font-medium">{r.revision}</span>
              <Badge className={submittalStatusTint(r.status)} variant="outline">
                {SUBMITTAL_STATUS_LABELS[r.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record review</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>Decision</Label>
              <Select
                value={reviewDecision}
                onValueChange={(v) => setReviewDecision(v as ReviewDecision)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_DECISIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {SUBMITTAL_STATUS_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Notes</Label>
              <Textarea
                rows={4}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending}>
              {reviewMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New revision</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              This creates a new draft revision (label auto-incremented).
            </p>
            <div className="flex flex-col gap-1">
              <Label>Attachment</Label>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" className="hidden" onChange={onFileChange} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {reviseFilePath ? "Replace" : "Upload"}
                </Button>
                {reviseFilePath ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {reviseFilePath.split("/").pop()}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => reviseMut.mutate()} disabled={reviseMut.isPending}>
              {reviseMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
