// P-264 — Controlled-document full-text search.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSearch, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  getDocumentSearchFacets,
  searchDocuments,
  signRegisteredDocumentUrl,
} from "@/lib/documents-search.functions";
import {
  groupByType,
  isSearchable,
  pushRecentSearch,
  readRecentSearches,
  snippetSegments,
  writeRecentSearches,
  type DocSearchHit,
} from "@/lib/documents-search.rules";

export const Route = createFileRoute("/_authenticated/documents/search")({
  head: () => ({
    meta: [
      { title: "Document search — GridMind" },
      {
        name: "description",
        content:
          "Search the controlled document register by number, title, tag, discipline or extracted content.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentSearchPage,
});

const ALL = "all";

function DocumentSearchPage() {
  const { t } = useI18n();
  const searchFn = useServerFn(searchDocuments);
  const facetsFn = useServerFn(getDocumentSearchFacets);
  const signFn = useServerFn(signRegisteredDocumentUrl);

  const [term, setTerm] = useState("");
  const [projectId, setProjectId] = useState(ALL);
  const [docType, setDocType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [discipline, setDiscipline] = useState(ALL);
  const [retentionClass, setRetentionClass] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [hits, setHits] = useState<DocSearchHit[] | null>(null);

  useEffect(() => setRecent(readRecentSearches()), []);

  const facets = useQuery({
    queryKey: ["doc-search", "facets"],
    queryFn: () => facetsFn({}),
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: (query: string) =>
      searchFn({
        data: {
          query,
          projectId: projectId === ALL ? null : projectId,
          docType: docType === ALL ? null : docType,
          status: status === ALL ? null : status,
          discipline: discipline === ALL ? null : discipline,
          retentionClass: retentionClass === ALL ? null : retentionClass,
          from: from || null,
          to: to || null,
        },
      }),
    onSuccess: (rows, query) => {
      setHits(rows);
      const next = pushRecentSearch(recent, query);
      setRecent(next);
      writeRecentSearches(next);
    },
    onError: () => toast.error(t("engMod.docSearch.failed")),
  });

  function submit(query: string) {
    if (!isSearchable(query)) {
      toast.error(t("engMod.docSearch.minLength"));
      return;
    }
    setTerm(query);
    run.mutate(query);
  }

  async function open(hit: DocSearchHit) {
    const { url } = await signFn({ data: { documentId: hit.id } });
    if (!url) {
      toast.error(t("engMod.docSearch.failed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const groups = useMemo(() => groupByType(hits ?? []), [hits]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("engMod.docSearch.title")}
        description={t("engMod.docSearch.subtitle")}
      />

      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSearch className="size-4" />
            {t("engMod.docSearch.scopeLabel")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("engMod.docSearch.scopeNote")}</p>
          <p className="text-xs text-muted-foreground">{t("engMod.docSearch.arabicNote")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              submit(term);
            }}
          >
            <Input
              value={term}
              maxLength={200}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t("engMod.docSearch.placeholder")}
              aria-label={t("engMod.docSearch.placeholder")}
            />
            <Button type="submit" disabled={run.isPending}>
              {run.isPending ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <Search className="me-2 size-4" />
              )}
              {t("engMod.docSearch.searchAction")}
            </Button>
          </form>

          <div className="grid gap-3 md:grid-cols-3">
            <FacetSelect
              id="f-project"
              label={t("engMod.docSearch.project")}
              value={projectId}
              onChange={setProjectId}
              options={(facets.data?.projects ?? []).map((p) => ({
                value: p.id,
                label: p.code ? `${p.code} — ${p.name}` : p.name,
              }))}
            />
            <FacetSelect
              id="f-type"
              label={t("engMod.docSearch.docType")}
              value={docType}
              onChange={setDocType}
              options={(facets.data?.docTypes ?? []).map((v) => ({ value: v, label: v }))}
            />
            <FacetSelect
              id="f-status"
              label={t("engMod.docSearch.status")}
              value={status}
              onChange={setStatus}
              options={(facets.data?.statuses ?? []).map((v) => ({ value: v, label: v }))}
            />
            <FacetSelect
              id="f-discipline"
              label={t("engMod.docSearch.discipline")}
              value={discipline}
              onChange={setDiscipline}
              options={(facets.data?.disciplines ?? []).map((v) => ({ value: v, label: v }))}
            />
            <FacetSelect
              id="f-retention"
              label={t("engMod.docSearch.retentionClass")}
              value={retentionClass}
              onChange={setRetentionClass}
              options={(facets.data?.retentionClasses ?? []).map((v) => ({ value: v, label: v }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="f-from" className="text-xs">
                  {t("engMod.docSearch.dateFrom")}
                </Label>
                <Input
                  id="f-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-to" className="text-xs">
                  {t("engMod.docSearch.dateTo")}
                </Label>
                <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </div>

          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("engMod.docSearch.recent")}</span>
              {recent.map((q) => (
                <Button key={q} size="sm" variant="outline" onClick={() => submit(q)}>
                  {q}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {run.isPending && (
        <p className="text-sm text-muted-foreground">{t("engMod.docSearch.searching")}</p>
      )}

      {hits !== null && !run.isPending && hits.length === 0 && (
        <EmptyState
          icon={FileSearch}
          title={t("engMod.docSearch.noResults")}
          description={t("engMod.docSearch.noResultsHint")}
        />
      )}

      {hits !== null && hits.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("engMod.docSearch.results", { count: hits.length })}
          </p>
          {groups.map((group) => (
            <Card key={group.docType}>
              <CardHeader>
                <CardTitle className="text-base">{group.docType}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {group.hits.map((hit) => (
                    <li key={hit.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium">
                          {hit.doc_number} — {hit.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {hit.current_revision && (
                            <Badge variant="outline">
                              {t("engMod.docSearch.revision", { rev: hit.current_revision })}
                            </Badge>
                          )}
                          {hit.status && <Badge variant="secondary">{hit.status}</Badge>}
                          <Badge variant="outline">
                            {hit.has_content
                              ? t("engMod.docSearch.contentIndexed")
                              : t("engMod.docSearch.metadataOnly")}
                          </Badge>
                          {hit.project_name && (
                            <span className="text-xs text-muted-foreground">
                              {hit.project_name}
                            </span>
                          )}
                        </div>
                        <Snippet snippet={hit.snippet} />
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void open(hit)}>
                        {t("engMod.docSearch.openDocument")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Snippet({ snippet }: { snippet: string | null }) {
  const segments = snippetSegments(snippet);
  if (segments.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {segments.map((seg, i) => {
        const key = `${i}-${seg.text}`;
        if (seg.mark) {
          return (
            <mark key={key} className="bg-accent text-accent-foreground">
              {seg.text}
            </mark>
          );
        }
        return <span key={key}>{seg.text}</span>;
      })}
    </p>
  );
}

function FacetSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("engMod.docSearch.all")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("engMod.docSearch.all")}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
