// Bug bash / UAT feedback capture. Anyone authenticated can submit; only
// super_admin can list existing items and change their status (verified
// server-side inside the ops-feedback functions).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import {
  getOpsFeedback,
  submitFeedback,
  updateFeedbackStatus,
  type OpsFeedbackCategory,
  type OpsFeedbackRow,
  type OpsFeedbackStatus,
} from "@/lib/feedback.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/admin/feedback")({
  head: () => ({
    meta: [
      { title: "Ops feedback | GridMind EPC Admin" },
      {
        name: "description",
        content: "Bug bash / UAT feedback capture and triage.",
      },
      { property: "og:title", content: "Ops feedback | GridMind EPC Admin" },
      {
        property: "og:description",
        content: "Log and triage bug bash / UAT feedback across the platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeedbackPage,
});

const CATEGORIES: OpsFeedbackCategory[] = ["bug", "ux", "performance", "security", "feature", "other"];
const SEVERITIES: Array<"info" | "warning" | "critical"> = ["info", "warning", "critical"];
const STATUSES: OpsFeedbackStatus[] = ["open", "triaged", "in_progress", "resolved", "closed"];

function severityTone(sev: string): "neutral" | "attention" | "critical" {
  if (sev === "critical") return "critical";
  if (sev === "warning") return "attention";
  return "neutral";
}

type FormState = {
  category: OpsFeedbackCategory;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  screenshot_url: string;
};

const EMPTY_FORM: FormState = {
  category: "bug",
  severity: "warning",
  title: "",
  description: "",
  screenshot_url: "",
};

function FeedbackPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const fetchFeedback = useServerFn(getOpsFeedback);
  const submit = useServerFn(submitFeedback);
  const updateStatus = useServerFn(updateFeedbackStatus);

  const list = useQuery({
    queryKey: ["ops-feedback"],
    queryFn: () => fetchFeedback({ data: {} }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ops-feedback"] });

  const submitMutation = useMutation({
    mutationFn: (vars: FormState) =>
      submit({
        data: {
          category: vars.category,
          severity: vars.severity,
          title: vars.title,
          description: vars.description.trim() ? vars.description.trim() : null,
          screenshot_url: vars.screenshot_url.trim() ? vars.screenshot_url.trim() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Feedback submitted");
      setForm(EMPTY_FORM);
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not submit feedback"),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: OpsFeedbackStatus }) => updateStatus({ data: vars }),
    onSuccess: () => {
      toast.success("Status updated");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update status"),
  });

  const canManage = !list.isError;

  return (
    <div className="page-shell max-w-6xl space-y-6">
      <PageHeader
        title={t("adminMod.admin.feedback")}
        description="Bug bash / UAT feedback capture and triage."
      />

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">Submit feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.title.trim()) {
                toast.error("Title is required");
                return;
              }
              submitMutation.mutate(form);
            }}
          >
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as OpsFeedbackCategory }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select
                value={form.severity}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, severity: v as "info" | "warning" | "critical" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Short summary of the issue"
                maxLength={200}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Steps to reproduce, expected vs. actual behaviour"
                rows={4}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Screenshot URL (optional)</Label>
              <Input
                value={form.screenshot_url}
                onChange={(e) => setForm((f) => ({ ...f, screenshot_url: e.target.value }))}
                placeholder="https://…"
                type="url"
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={submitMutation.isPending}>
                Submit feedback
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {list.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : list.isError ? (
        <EmptyState
          icon={MessageSquareWarning}
          title="Feedback list unavailable"
          description="Only super admins can view the feedback inbox. Your submission above was still recorded."
        />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title="No feedback yet"
          description="Submitted bug bash / UAT items will show up here."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="text-right">Update status</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data as OpsFeedbackRow[]).map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{f.category}</TableCell>
                  <TableCell>
                    <StatusBadge status={f.severity} tone={severityTone(f.severity)} />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{f.title}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {f.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={f.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={f.status}
                      onValueChange={(v) =>
                        statusMutation.mutate({ id: f.id, status: v as OpsFeedbackStatus })
                      }
                    >
                      <SelectTrigger className="w-36 ml-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
