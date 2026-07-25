// P-091 — Create a transmittal with a document picker.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTransmittal } from "@/lib/transmittals.functions";
import {
  errorMessage,
  projectDocumentsQueryOptions,
  transmittalProjectsQueryOptions,
} from "@/lib/transmittals-query";
import {
  TRANSMITTAL_DIRECTIONS,
  TRANSMITTAL_DIRECTION_LABELS,
  type TransmittalDirection,
  type TransmittalItem,
} from "@/lib/transmittals.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/field/transmittals/new")({
  validateSearch: (raw): z.infer<typeof searchSchema> =>
    searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "New transmittal — GridMind EPC" },
      {
        name: "description",
        content: "Compile documents and issue an outgoing or incoming transmittal.",
      },
      { property: "og:title", content: "New transmittal — GridMind EPC" },
      {
        property: "og:description",
        content: "Pick documents from the project and send as a transmittal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewTransmittalPage,
});

function NewTransmittalPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const qc = useQueryClient();
  const projectsQuery = useQuery(transmittalProjectsQueryOptions());

  const [projectId, setProjectId] = useState<string>(sp.projectId ?? "");
  const [direction, setDirection] = useState<TransmittalDirection>("outgoing");
  const [fromParty, setFromParty] = useState("");
  const [toParty, setToParty] = useState("");
  const [subject, setSubject] = useState("");
  const [responseDue, setResponseDue] = useState("");
  const [items, setItems] = useState<TransmittalItem[]>([]);
  const [pickDocId, setPickDocId] = useState<string>("");
  const [manualDesc, setManualDesc] = useState("");

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      setProjectId(projectsQuery.data![0].id);
    }
  }, [projectsQuery.data, projectId]);

  const docsQuery = useQuery(projectDocumentsQueryOptions(projectId || null));
  const docs = docsQuery.data ?? [];
  const docMap = useMemo(() => {
    const m = new Map<string, (typeof docs)[number]>();
    for (const d of docs) m.set(d.id, d);
    return m;
  }, [docs]);

  const addDoc = () => {
    if (!pickDocId) return;
    const d = docMap.get(pickDocId);
    if (!d) return;
    if (items.some((it) => it.document_id === d.id)) return;
    setItems((prev) => [
      ...prev,
      { document_id: d.id, description: d.title, revision: null, copies: 1 },
    ]);
    setPickDocId("");
  };

  const addManual = () => {
    if (manualDesc.trim().length === 0) return;
    setItems((prev) => [
      ...prev,
      { document_id: null, description: manualDesc.trim(), revision: null, copies: 1 },
    ]);
    setManualDesc("");
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const patchItem = (idx: number, patch: Partial<TransmittalItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const createMut = useMutation({
    mutationFn: () =>
      createTransmittal({
        data: {
          projectId,
          direction,
          fromParty,
          toParty,
          subject,
          items,
          responseDue: responseDue || null,
        } as any,
      }),
    onSuccess: async (row) => {
      toast.success(`${(row as any).transmittal_number} created`);
      await qc.invalidateQueries({ queryKey: ["transmittals"] });
      void navigate({
        to: "/field/transmittals/$id",
        params: { id: (row as any).id },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canSubmit =
    !!projectId &&
    fromParty.trim().length > 0 &&
    toParty.trim().length > 0 &&
    subject.trim().length >= 2 &&
    items.length > 0 &&
    !createMut.isPending;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-24 md:p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/field/transmittals"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to transmittals
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          New transmittal
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Direction</Label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as TransmittalDirection)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSMITTAL_DIRECTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {TRANSMITTAL_DIRECTION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>From</Label>
            <Input value={fromParty} onChange={(e) => setFromParty(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>To</Label>
            <Input value={toParty} onChange={(e) => setToParty(e.target.value)} />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Response due</Label>
            <Input
              type="date"
              value={responseDue}
              onChange={(e) => setResponseDue(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <Select
              value={pickDocId}
              onValueChange={setPickDocId}
              disabled={!projectId || docsQuery.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Add project document…" />
              </SelectTrigger>
              <SelectContent>
                {docs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={addDoc} disabled={!pickDocId}>
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <Input
              placeholder="…or type a manual line item"
              value={manualDesc}
              onChange={(e) => setManualDesc(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addManual}
              disabled={manualDesc.trim().length === 0}
            >
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </div>

          {items.length === 0 ? (
            <Alert>
              <AlertTitle>No items yet</AlertTitle>
              <AlertDescription className="text-xs">
                Pick a document or add a manual line to include in the transmittal.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_100px_80px_auto] items-center gap-2 rounded-md border border-border p-2"
                >
                  <Input
                    value={it.description}
                    onChange={(e) => patchItem(idx, { description: e.target.value })}
                  />
                  <Input
                    placeholder="Rev"
                    value={it.revision ?? ""}
                    onChange={(e) => patchItem(idx, { revision: e.target.value || null })}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={it.copies}
                    onChange={(e) =>
                      patchItem(idx, {
                        copies: Math.max(1, Math.min(999, Number(e.target.value) || 1)),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(idx)}
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background py-3">
        <Button variant="outline" asChild>
          <Link to="/field/transmittals">Cancel</Link>
        </Button>
        <Button disabled={!canSubmit} onClick={() => createMut.mutate()}>
          {createMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Create transmittal
        </Button>
      </div>
    </div>
  );
}
