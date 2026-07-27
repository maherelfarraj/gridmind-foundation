// P-208 — Chart of accounts: per-event debit/credit mapping with audit on every change.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ListTree, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateGlMapping } from "@/lib/gl.functions";
import { glErrorInfo, glWorkspaceQueryOptions } from "@/lib/gl.query";
import {
  GL_EVENT_LABELS,
  GL_EVENT_TYPES,
  UpdateGlMappingSchema,
  type GlEventType,
  type GlMapping,
} from "@/lib/gl.rules";

export const Route = createFileRoute("/_authenticated/finance/gl-export/mappings")({
  head: () => ({
    meta: [
      { title: "Chart of accounts — GridMind EPC" },
      {
        name: "description",
        content:
          "Map each finance event type to the debit and credit accounts used by the GL export journal.",
      },
      { property: "og:title", content: "Chart of accounts — GridMind EPC" },
      {
        property: "og:description",
        content: "Debit and credit account mappings that drive the GL export journal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GlMappingsPage,
});

type Draft = Omit<GlMapping, "id">;

function emptyDraft(event: GlEventType): Draft {
  return {
    event_type: event,
    debit_account_code: "",
    debit_account_name: "",
    credit_account_code: "",
    credit_account_name: "",
    enabled: true,
  };
}

function GlMappingsPage() {
  const queryClient = useQueryClient();
  const workspace = useQuery(glWorkspaceQueryOptions());
  const save = useServerFn(updateGlMapping);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  useEffect(() => {
    const rows = workspace.data?.mappings;
    if (!rows) return;
    setDrafts(
      Object.fromEntries(
        GL_EVENT_TYPES.map((event) => {
          const found = rows.find((m) => m.event_type === event);
          return [event, found ? { ...found, id: undefined } : emptyDraft(event)];
        }),
      ) as Record<string, Draft>,
    );
  }, [workspace.data]);

  const canWrite = workspace.data?.can_write ?? false;

  const mutation = useMutation({
    mutationFn: (draft: Draft) => save({ data: UpdateGlMappingSchema.parse(draft) }),
    onSuccess: (_res, draft) => {
      toast.success(`${GL_EVENT_LABELS[draft.event_type]} mapping saved.`);
      void queryClient.invalidateQueries({ queryKey: ["gl"] });
    },
    onError: (err) => toast.error(glErrorInfo(err).message),
  });

  function patch(event: GlEventType, values: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [event]: { ...(prev[event] ?? emptyDraft(event)), ...values },
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of accounts"
        description="Each finance event posts one debit and one credit line. Account codes are 4–10 alphanumeric characters."
        actions={
          <Button variant="outline" asChild>
            <Link to="/finance/gl-export">
              <ArrowLeft className="mr-2 size-4" /> Back to GL export
            </Link>
          </Button>
        }
      />

      {workspace.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Event</TableHead>
                <TableHead>Debit account</TableHead>
                <TableHead>Credit account</TableHead>
                <TableHead className="w-24">Enabled</TableHead>
                <TableHead className="w-24 text-right">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {GL_EVENT_TYPES.map((event) => {
                const draft = drafts[event] ?? emptyDraft(event);
                const valid = UpdateGlMappingSchema.safeParse(draft).success;
                return (
                  <TableRow key={event}>
                    <TableCell className="align-top font-medium">
                      <span className="flex items-center gap-2">
                        <ListTree className="size-4 text-muted-foreground" />
                        {GL_EVENT_LABELS[event]}
                      </span>
                    </TableCell>
                    <TableCell className="space-y-2 align-top">
                      <Input
                        aria-label={`${GL_EVENT_LABELS[event]} debit account code`}
                        placeholder="1200"
                        value={draft.debit_account_code}
                        disabled={!canWrite}
                        onChange={(e) => patch(event, { debit_account_code: e.target.value })}
                        className="w-32 font-mono"
                      />
                      <Input
                        aria-label={`${GL_EVENT_LABELS[event]} debit account name`}
                        placeholder="Accounts receivable"
                        value={draft.debit_account_name}
                        disabled={!canWrite}
                        onChange={(e) => patch(event, { debit_account_name: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="space-y-2 align-top">
                      <Input
                        aria-label={`${GL_EVENT_LABELS[event]} credit account code`}
                        placeholder="4000"
                        value={draft.credit_account_code}
                        disabled={!canWrite}
                        onChange={(e) => patch(event, { credit_account_code: e.target.value })}
                        className="w-32 font-mono"
                      />
                      <Input
                        aria-label={`${GL_EVENT_LABELS[event]} credit account name`}
                        placeholder="Contract revenue"
                        value={draft.credit_account_name}
                        disabled={!canWrite}
                        onChange={(e) => patch(event, { credit_account_name: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Switch
                        aria-label={`${GL_EVENT_LABELS[event]} enabled`}
                        checked={draft.enabled}
                        disabled={!canWrite}
                        onCheckedChange={(v) => patch(event, { enabled: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canWrite || !valid || mutation.isPending}
                        onClick={() => mutation.mutate(draft)}
                      >
                        <Save className="mr-2 size-4" /> Save
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">
          Only finance or company admins can edit the chart of accounts.
        </p>
      ) : null}
    </div>
  );
}
