// P-091 — Raise an NCR. Accepts deep-link prefills (source, sourceId, projectId).
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
import { errorMessage, ncrCurrenciesQueryOptions, ncrProjectsQueryOptions } from "@/lib/ncr-query";
import { createNcr } from "@/lib/ncr.functions";
import { NCR_SOURCE_LABELS, NCR_SOURCES, type NcrSource } from "@/lib/ncr.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  source: z.enum(NCR_SOURCES).optional(),
  sourceId: z.string().uuid().optional(),
  discipline: z.string().max(80).optional(),
  area: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/qaqc/ncrs/new")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Raise NCR — GridMind EPC" },
      {
        name: "description",
        content: "Raise a non-conformance report from an inspection, punch item, or observation.",
      },
      { property: "og:title", content: "Raise NCR — GridMind EPC" },
      {
        property: "og:description",
        content: "Deep-link from a failed inspection to prefill source, area, and discipline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewNcrPage,
});

function NewNcrPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const qc = useQueryClient();
  const projectsQuery = useQuery(ncrProjectsQueryOptions());
  const currenciesQuery = useQuery(ncrCurrenciesQueryOptions());

  const [projectId, setProjectId] = useState<string>(sp.projectId ?? "");
  const [source, setSource] = useState<NcrSource>(sp.source ?? "other");
  const [sourceId] = useState<string | undefined>(sp.sourceId);
  const [discipline, setDiscipline] = useState(sp.discipline ?? "");
  const [area, setArea] = useState(sp.area ?? "");
  const [description, setDescription] = useState("");
  const [costImpact, setCostImpact] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      setProjectId(projectsQuery.data![0].id);
    }
  }, [projectsQuery.data, projectId]);

  const createMut = useMutation({
    mutationFn: () =>
      createNcr({
        data: {
          projectId,
          source,
          sourceId: sourceId ?? null,
          discipline: discipline || null,
          area: area || null,
          description,
          costImpact: costImpact ? Number(costImpact) : null,
          currencyCode: costImpact ? currency : null,
        } as any,
      }),
    onSuccess: async (row) => {
      toast.success(`${row.ncr_number} raised.`);
      await qc.invalidateQueries({ queryKey: ["ncr"] });
      void navigate({ to: "/qaqc/ncrs/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canSubmit = !!projectId && description.trim().length >= 4 && !createMut.isPending;

  return (
    <div className="page-shell">
      <div>
        <Link
          to="/qaqc/ncrs"
          className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to NCRs
        </Link>
        <PageHeader title="Raise NCR" description="Raise a non-conformance report." />
        {sp.source && sp.sourceId ? (
          <Alert>
            <AlertTitle>Prefilled from {NCR_SOURCE_LABELS[sp.source]}</AlertTitle>
            <AlertDescription className="text-xs">
              Source link {sp.sourceId.slice(0, 8)}… will be attached.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
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
            <Label>Source</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as NcrSource)}
              disabled={!!sp.source}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NCR_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {NCR_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Discipline</Label>
            <Input
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              placeholder="civil / mechanical / electrical / …"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Area</Label>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Block A / Substation …"
            />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>Description</Label>
            <Textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the non-conformance …"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Cost impact (optional)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={costImpact}
              onChange={(e) => setCostImpact(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(currenciesQuery.data ?? ["USD"]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background py-3">
        <Button variant="outline" asChild>
          <Link to="/qaqc/ncrs">Cancel</Link>
        </Button>
        <Button disabled={!canSubmit} onClick={() => createMut.mutate()}>
          {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Raise NCR
        </Button>
      </div>
    </div>
  );
}
