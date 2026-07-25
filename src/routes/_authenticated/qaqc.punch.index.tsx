// P-090 — Punch list board/list toggle with "Open A items" KPI.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LayoutGrid, List, Plus, Search } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  errorMessage,
  punchListQueryOptions,
  qaqcProjectsQueryOptions,
} from "@/lib/qaqc-query";
import {
  PUNCH_CATEGORIES,
  PUNCH_CATEGORY_LABELS,
  PUNCH_STATUS_LABELS,
  PUNCH_STATUSES,
  punchCategoryTint,
  punchStatusTint,
  QAQC_DISCIPLINES,
  QAQC_DISCIPLINE_LABELS,
  type PunchCategory,
  type PunchStatus,
  type QaqcDiscipline,
} from "@/lib/qaqc.rules";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  category: z.enum(PUNCH_CATEGORIES).optional(),
  status: z.enum(PUNCH_STATUSES).optional(),
  discipline: z.enum(QAQC_DISCIPLINES).optional(),
  area: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  view: z.enum(["board", "list"]).optional(),
});

export const Route = createFileRoute("/_authenticated/qaqc/punch/")({
  validateSearch: (raw): z.infer<typeof searchSchema> =>
    searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Punch list — GridMind EPC" },
      {
        name: "description",
        content:
          "Track A/B/C punch items across projects and close them out with typed signoff.",
      },
      { property: "og:title", content: "Punch list — GridMind EPC" },
      {
        property: "og:description",
        content: "Category A blockers, handover items, cosmetic snags — all in one board.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PunchIndexPage,
});

function PunchIndexPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const view = sp.view ?? "board";
  const projectsQuery = useQuery(qaqcProjectsQueryOptions());

  const [search, setSearch] = useState(sp.search ?? "");

  const filters = useMemo(
    () => ({
      projectId: sp.projectId ?? null,
      category: (sp.category ?? null) as PunchCategory | null,
      status: (sp.status ?? null) as PunchStatus | null,
      discipline: (sp.discipline ?? null) as QaqcDiscipline | null,
      area: sp.area ?? null,
      search: search || null,
    }),
    [sp.projectId, sp.category, sp.status, sp.discipline, sp.area, search],
  );
  const listQuery = useQuery(punchListQueryOptions(filters));
  const items = listQuery.data ?? [];

  const openA = items.filter(
    (i) => i.category === "A" && i.status !== "closed" && i.status !== "void",
  ).length;
  const openB = items.filter(
    (i) => i.category === "B" && i.status !== "closed" && i.status !== "void",
  ).length;
  const openC = items.filter(
    (i) => i.category === "C" && i.status !== "closed" && i.status !== "void",
  ).length;
  const readyForReview = items.filter((i) => i.status === "ready_for_review").length;

  function updateSearch(patch: Partial<z.infer<typeof searchSchema>>) {
    navigate({
      to: "/qaqc/punch",
      search: ((prev: any) => ({ ...prev, ...patch })) as any,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground md:text-3xl">
            Punch list
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Category A items block COD. B items block handover. C is cosmetic.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/qaqc/punch/walk">
              <Plus className="mr-2 h-4 w-4" /> Punch walk
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Open A (blockers)"
          value={openA}
          tone={openA > 0 ? "destructive" : "muted"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiTile label="Open B" value={openB} tone="warning" />
        <KpiTile label="Open C" value={openC} tone="muted" />
        <KpiTile
          label="Ready for review"
          value={readyForReview}
          tone={readyForReview > 0 ? "warning" : "muted"}
        />
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <FilterField label="Project">
              <Select
                value={sp.projectId ?? "all"}
                onValueChange={(v) =>
                  updateSearch({ projectId: v === "all" ? undefined : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {(projectsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Category">
              <Select
                value={sp.category ?? "all"}
                onValueChange={(v) =>
                  updateSearch({
                    category:
                      v === "all" ? undefined : (v as PunchCategory),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {PUNCH_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {PUNCH_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status">
              <Select
                value={sp.status ?? "all"}
                onValueChange={(v) =>
                  updateSearch({
                    status: v === "all" ? undefined : (v as PunchStatus),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {PUNCH_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PUNCH_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Discipline">
              <Select
                value={sp.discipline ?? "all"}
                onValueChange={(v) =>
                  updateSearch({
                    discipline:
                      v === "all" ? undefined : (v as QaqcDiscipline),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {QAQC_DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {QAQC_DISCIPLINE_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Area">
              <Input
                value={sp.area ?? ""}
                onChange={(e) =>
                  updateSearch({ area: e.target.value || undefined })
                }
                placeholder="e.g. Block A"
              />
            </FilterField>
            <FilterField label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Number, description…"
                  className="pl-8"
                />
              </div>
            </FilterField>
          </div>
          <div className="flex items-center justify-between">
            <Tabs
              value={view}
              onValueChange={(v) =>
                updateSearch({ view: v as "board" | "list" })
              }
            >
              <TabsList>
                <TabsTrigger value="board">
                  <LayoutGrid className="mr-1 h-4 w-4" /> Board
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List className="mr-1 h-4 w-4" /> List
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-xs text-muted-foreground">
              {listQuery.isFetching ? "Loading…" : `${items.length} item(s)`}
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : listQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {errorMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No punch items match the current filters.
            </p>
            <Button asChild>
              <Link to="/qaqc/punch/walk">
                <Plus className="mr-2 h-4 w-4" /> Start a punch walk
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : view === "board" ? (
        <BoardView items={items} />
      ) : (
        <ListView items={items} />
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "destructive" | "warning" | "muted";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border bg-card text-foreground";
  return (
    <Card className={`border ${toneClass}`}>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
          {icon}
          {label}
        </div>
        <div className="font-display text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

type Item = NonNullable<
  ReturnType<typeof useQuery<typeof punchListQueryOptions>>["data"]
> extends readonly (infer T)[]
  ? T
  : never;

function BoardView({ items }: { items: any[] }) {
  const columns: PunchCategory[] = ["A", "B", "C"];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {columns.map((cat) => {
        const colItems = items.filter((i) => i.category === cat);
        return (
          <Card key={cat}>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${punchCategoryTint(cat)}`}
                  >
                    {PUNCH_CATEGORY_LABELS[cat]}
                  </span>
                </div>
                <Badge variant="outline">{colItems.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {colItems.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Nothing here.
                  </p>
                ) : (
                  colItems.map((i) => <PunchCard key={i.id} item={i} />)
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ListView({ items }: { items: any[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {items.map((i) => (
            <Link
              key={i.id}
              to="/qaqc/punch/$id"
              params={{ id: i.id }}
              className="flex items-center gap-3 p-3 hover:bg-muted/50"
            >
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${punchCategoryTint(i.category)}`}
              >
                {i.category}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="font-mono text-xs text-muted-foreground">
                    {i.punch_number}
                  </span>
                  <span className="truncate">{i.description}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {i.project_name ?? "—"} · {i.area} ·{" "}
                  {QAQC_DISCIPLINE_LABELS[i.discipline as QaqcDiscipline]}
                </div>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-xs ${punchStatusTint(i.status)}`}
              >
                {PUNCH_STATUS_LABELS[i.status as PunchStatus]}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PunchCard({ item }: { item: any }) {
  return (
    <Link
      to="/qaqc/punch/$id"
      params={{ id: item.id }}
      className="flex flex-col gap-1 rounded-md border border-border p-3 hover:border-primary hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {item.punch_number}
        </span>
        <span
          className={`rounded-md px-2 py-0.5 text-xs ${punchStatusTint(item.status)}`}
        >
          {PUNCH_STATUS_LABELS[item.status as PunchStatus]}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-foreground">{item.description}</p>
      <div className="text-xs text-muted-foreground">
        {item.area} ·{" "}
        {QAQC_DISCIPLINE_LABELS[item.discipline as QaqcDiscipline]}
        {item.due_date ? ` · due ${item.due_date}` : ""}
      </div>
    </Link>
  );
}
