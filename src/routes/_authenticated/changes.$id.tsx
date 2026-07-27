// P-190 — Change request detail workspace.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, FileUp, Network, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AffectedSystems } from "@/components/moc/affected-systems";
import { ChangeTypeBadge } from "@/components/moc/change-type-badge";
import { ImplementationTasks } from "@/components/moc/implementation-tasks";
import { VendorSubstitution } from "@/components/moc/vendor-substitution";
import {
  ImpactCards,
  draftToPayload,
  toDraft,
  type ImpactDraft,
} from "@/components/moc/impact-cards";
import { ReviewerStepper } from "@/components/moc/reviewer-stepper";

import { ThreadGraph } from "@/components/thread/thread-graph";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { decideApproval } from "@/lib/approvals.inbox.functions";
import { getEntityThread } from "@/lib/digital-thread/thread.functions";
import { formatDateTime } from "@/lib/format";
import { evidencePath, unassessedAreas, type AffectedSystem } from "@/lib/moc.rules";
import { parseOpenTasksError } from "@/lib/moc.exec.rules";
import {
  closeChangeRequest,
  generateImplementationTasks,
  listImplementationTasks,
} from "@/lib/moc.exec.functions";

import {
  addChangeEvidence,
  getChangeRequest,
  signChangeEvidenceUrl,
  submitChangeRequest,
  transitionChangeRequest,
  updateChangeImpacts,
} from "@/lib/moc.functions";

export const Route = createFileRoute("/_authenticated/changes/$id")({
  head: () => ({
    meta: [
      { title: "Change request — GridMind EPC" },
      { name: "description", content: "Impact assessment, reviewer routing and implementation." },
    ],
  }),
  component: ChangeDetailPage,
});

function ChangeDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDetail = useServerFn(getChangeRequest);
  const saveImpacts = useServerFn(updateChangeImpacts);
  const submitFn = useServerFn(submitChangeRequest);
  const transitionFn = useServerFn(transitionChangeRequest);
  const decideFn = useServerFn(decideApproval);
  const addEvidenceFn = useServerFn(addChangeEvidence);
  const signUrlFn = useServerFn(signChangeEvidenceUrl);
  const fetchThread = useServerFn(getEntityThread);

  const detail = useQuery({
    queryKey: ["moc", "detail", id],
    queryFn: () => fetchDetail({ data: { id } }),
  });

  const [draft, setDraft] = useState<ImpactDraft | null>(null);
  const [systems, setSystems] = useState<AffectedSystem[] | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closureNotes, setClosureNotes] = useState("");
  const [updatedDocs, setUpdatedDocs] = useState("");
  const [updatedAsbuilts, setUpdatedAsbuilts] = useState("");
  const [uploading, setUploading] = useState(false);

  const cr = detail.data?.cr;
  useEffect(() => {
    if (cr) {
      setDraft(toDraft(cr));
      setSystems(cr.affected_systems);
    }
  }, [cr]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["moc"] });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveImpacts({
        data: { id, ...draftToPayload(draft!), affected_systems: systems ?? [] },
      }),
    onSuccess: () => {
      toast.success("Impact assessment saved");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save"),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Submitted for assessment");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not submit"),
  });

  const transitionMutation = useMutation({
    mutationFn: (input: {
      to: "approved" | "rejected" | "implementing" | "closed" | "cancelled";
      rejection_reason?: string;
      closure_notes?: string;
      updated_documents?: string[];
      updated_asbuilts?: string[];
    }) => transitionFn({ data: { id, ...input } }),
    onSuccess: (_r, input) => {
      toast.success(`Change request moved to ${input.to}`);
      setCloseOpen(false);
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Transition rejected"),
  });

  const decideMutation = useMutation({
    mutationFn: (input: { decision: "approved" | "rejected"; comment?: string }) =>
      decideFn({
        data: {
          approval_id: detail.data!.myPendingApprovalId!,
          decision: input.decision,
          comment: input.comment ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Decision recorded");
      setRejectOpen(false);
      setRejectComment("");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not record the decision"),
  });

  const thread = useQuery({
    queryKey: ["moc", "thread", "change_request", id],
    queryFn: () => fetchThread({ data: { entityType: "change_request", entityId: id, depth: 2 } }),
    enabled: Boolean(detail.data),
  });

  const missing = useMemo(() => (cr ? unassessedAreas(cr) : []), [cr]);

  if (detail.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (detail.isError || !detail.data || !cr || !draft || !systems) {
    return (
      <div className="p-6">
        <EmptyState
          title="Change request unavailable"
          description="It may have been removed, or you may not have access."
          action={
            <Button variant="outline" onClick={() => void detail.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const data = detail.data;
  const editable = data.canEdit;
  const evidence = cr.implementation_evidence;

  async function uploadEvidence(file: File) {
    setUploading(true);
    try {
      const path = evidencePath(cr!.company_id, cr!.id, file.name);
      const { error } = await supabase.storage.from("documents").upload(path, file);
      if (error) throw error;
      await addEvidenceFn({ data: { id, path, filename: file.name, size: file.size } });
      toast.success("Evidence uploaded");
      void invalidate();
    } catch (error) {
      toast.error((error as Error).message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openEvidence(path: string) {
    try {
      const { url } = await signUrlFn({ data: { path } });
      if (url) window.open(url, "_blank", "noopener");
    } catch {
      toast.error("Could not open the file");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void navigate({
            to: "/changes",
            search: { status: undefined, type: undefined, project: undefined },
          })
        }
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to register
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base text-muted-foreground">{cr.cr_number}</span>
            <span>{cr.title}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ChangeTypeBadge type={cr.change_type} />
            <StatusBadge status={cr.status} />
            {cr.project_name ? <span>{cr.project_name}</span> : null}
            <span>Raised by {cr.originator_name ?? "unknown"}</span>
          </span>
        }
        actions={
          <>
            {editable ? (
              <Button
                variant="outline"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                Save assessment
              </Button>
            ) : null}
            {cr.status === "draft" ? (
              <Button disabled={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
                Submit for assessment
              </Button>
            ) : null}
            {cr.status === "assessment" && data.myPendingApprovalId ? (
              <>
                <Button
                  disabled={decideMutation.isPending}
                  onClick={() => decideMutation.mutate({ decision: "approved" })}
                >
                  Approve
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
              </>
            ) : null}
            {cr.status === "assessment" && data.instance?.status === "approved" ? (
              <Button onClick={() => transitionMutation.mutate({ to: "approved" })}>
                Sync status
              </Button>
            ) : null}
            {cr.status === "assessment" && data.instance?.status === "rejected" ? (
              <Button
                variant="destructive"
                onClick={() =>
                  transitionMutation.mutate({
                    to: "rejected",
                    rejection_reason: "Approval chain rejected the change.",
                  })
                }
              >
                Sync status
              </Button>
            ) : null}
            {cr.status === "approved" ? (
              <Button onClick={() => transitionMutation.mutate({ to: "implementing" })}>
                Begin implementation
              </Button>
            ) : null}
            {cr.status === "implementing" ? (
              <Button disabled={evidence.length === 0} onClick={() => setCloseOpen(true)}>
                Close change
              </Button>
            ) : null}
            {(cr.status === "draft" || cr.status === "assessment") &&
            (data.isAdmin || cr.originator_id) ? (
              <Button
                variant="outline"
                onClick={() => transitionMutation.mutate({ to: "cancelled" })}
              >
                Cancel change
              </Button>
            ) : null}
          </>
        }
      />

      {cr.status === "draft" && missing.length > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-accent/15 px-3 py-2 text-sm text-accent">
          <ShieldAlert className="size-4" aria-hidden />
          Not assessed: {missing.join(", ")}. Submission is allowed but the gaps are flagged to
          reviewers.
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="thread">Digital thread</TabsTrigger>
          <TabsTrigger value="tasks">Implementation tasks</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-medium text-foreground">What is changing</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{cr.description}</p>
            <Separator />
            <h2 className="text-sm font-medium text-foreground">Why</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{cr.reason}</p>
          </Card>

          <ImpactCards cr={cr} editable={editable} draft={draft} onChange={setDraft} />

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-medium text-foreground">Affected systems</h2>
            <AffectedSystems rows={systems} editable={editable} onChange={setSystems} />
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-medium text-foreground">Reviewer routing</h2>
            <ReviewerStepper steps={data.steps} currentStep={data.instance?.current_step ?? null} />
          </Card>

          {cr.status === "implementing" || evidence.length > 0 ? (
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-foreground">Implementation evidence</h2>
                {cr.status === "implementing" ? (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      aria-label="Upload evidence"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadEvidence(file);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      <FileUp className="mr-1 size-4" aria-hidden />
                      {uploading ? "Uploading…" : "Upload evidence"}
                    </Button>
                  </>
                ) : null}
              </div>
              {evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  At least one evidence item is required before closing.
                </p>
              ) : (
                <ul className="space-y-1">
                  {evidence.map((item, i) => (
                    <li key={`${String(item.path)}-${i}`}>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-sm"
                        onClick={() => void openEvidence(String(item.path))}
                      >
                        {String(item.filename ?? item.path)}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {cr.closure_notes ? (
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-medium text-foreground">Closure</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {cr.closure_notes}
              </p>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="thread" className="pt-4">
          {thread.isPending ? <Skeleton className="h-64 w-full" /> : null}
          {thread.data && thread.data.graph.nodes.length > 0 ? (
            <ThreadGraph graph={thread.data.graph} />
          ) : null}
          {thread.data && thread.data.graph.nodes.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No linked records yet"
              description="Links appear once the change touches drawings, orders or field records."
            />
          ) : null}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-3 pt-4">
          {cr.updated_documents.length === 0 && cr.updated_asbuilts.length === 0 ? (
            <EmptyState
              title="No implementation tasks recorded"
              description="Updated documents and as-builts are captured when the change is closed."
            />
          ) : (
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-medium text-foreground">Updated documents</h2>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {cr.updated_documents.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <Separator />
              <h2 className="text-sm font-medium text-foreground">Updated as-builts</h2>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {cr.updated_asbuilts.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-3 pt-4">
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            This trail is append-only and cannot be edited.
          </div>
          {data.audit.length === 0 ? (
            <EmptyState title="No audit entries yet" compact />
          ) : (
            <ul className="space-y-2">
              {data.audit.map((entry) => (
                <li key={entry.id} className="rounded-md border border-border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{entry.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(entry.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{entry.actor_name ?? "System"}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this change</DialogTitle>
            <DialogDescription>A comment is required when rejecting.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Why is this rejected?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectComment.trim().length === 0 || decideMutation.isPending}
              onClick={() =>
                decideMutation.mutate({ decision: "rejected", comment: rejectComment.trim() })
              }
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close change {cr.cr_number}</DialogTitle>
            <DialogDescription>
              Record what was implemented and which documents were updated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={4}
              placeholder="Closure notes (required)"
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder="Updated documents, one per line"
              value={updatedDocs}
              onChange={(e) => setUpdatedDocs(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder="Updated as-builts, one per line"
              value={updatedAsbuilts}
              onChange={(e) => setUpdatedAsbuilts(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                closureNotes.trim().length === 0 ||
                evidence.length === 0 ||
                transitionMutation.isPending
              }
              onClick={() =>
                transitionMutation.mutate({
                  to: "closed",
                  closure_notes: closureNotes.trim(),
                  updated_documents: updatedDocs
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  updated_asbuilts: updatedAsbuilts
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            >
              Close change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        Need the wider picture? <Link to="/changes/dashboard">Open the impact dashboard</Link>.
      </p>
    </div>
  );
}
