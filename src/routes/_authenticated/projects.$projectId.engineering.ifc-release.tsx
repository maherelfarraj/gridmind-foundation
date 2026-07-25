// P-060 — IFC release workspace.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { FileText, Lock, ShieldCheck, Send, Ban } from "lucide-react";

import {
  getIfcKpis,
  getIfcRelease,
  getMyIfcRole,
  IFC_SIGNOFF_ROLES,
  listIfcReleases,
  listReleasableDrawings,
  type IfcSignoffRoleLabel,
} from "@/lib/ifc-release.functions";
import {
  ifcKpisOptions,
  ifcReleaseDetailOptions,
  ifcReleasesListOptions,
  myIfcRoleOptions,
  releasableDrawingsOptions,
  useNotifyDistribution,
  usePrepareIfcRelease,
  useReleaseIfc,
  useSignIfcRelease,
  useVoidIfcRelease,
} from "@/lib/ifc-release-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/ifc-release")(
  {
    component: IfcReleasePage,
  },
);

function IfcReleasePage() {
  const { projectId } = Route.useParams();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">IFC release ceremony</h1>
        <p className="text-sm text-muted-foreground">
          Package eligible IFD drawings, collect role sign-offs, and release the Issued for
          Construction bundle.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <KpiStrip projectId={projectId} />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <PrepareCard projectId={projectId} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <ReleaseListCard projectId={projectId} />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <ActiveReleasePanel projectId={projectId} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
function KpiStrip({ projectId }: { projectId: string }) {
  const fn = useServerFn(getIfcKpis);
  const { data } = useSuspenseQuery(ifcKpisOptions(fn, projectId));
  const cards = [
    { label: "Released packages", value: data.released_count },
    {
      label: "Design cycle",
      value: data.design_cycle_days == null ? "—" : `${data.design_cycle_days} d`,
    },
    { label: "Changes after IFC", value: data.change_orders_after_ifc },
    {
      label: "Latest release",
      value: data.latest_released_at ? new Date(data.latest_released_at).toLocaleDateString() : "—",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="pb-1">
            <CardDescription>{c.label}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{c.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prepare card
// ---------------------------------------------------------------------------
function PrepareCard({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listReleasableDrawings);
  const roleFn = useServerFn(getMyIfcRole);
  const { data: drawings } = useSuspenseQuery(releasableDrawingsOptions(listFn, projectId));
  const { data: myRole } = useSuspenseQuery(myIfcRoleOptions(roleFn, projectId));
  const prepare = usePrepareIfcRelease(projectId);

  const [packageName, setPackageName] = useState("IFC Package v1");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const eligibleIds = useMemo(
    () => drawings.filter((d) => d.eligible).map((d) => d.drawing_id),
    [drawings],
  );

  const chosen = Object.keys(selected).filter((k) => selected[k]);

  const canSubmit = myRole.isAdmin && chosen.length > 0 && packageName.trim().length >= 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prepare package</CardTitle>
        <CardDescription>
          Only drawings with a signed-off latest IFD revision are eligible.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-name">Package name</Label>
            <Input
              id="pkg-name"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              disabled={!myRole.isAdmin}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelected(Object.fromEntries(eligibleIds.map((id) => [id, true])))}
              disabled={!myRole.isAdmin || eligibleIds.length === 0}
            >
              Select all eligible
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected({})}>
              Clear
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pkg-notes">Notes</Label>
          <Textarea
            id="pkg-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={!myRole.isAdmin}
          />
        </div>

        <div className="rounded-md border border-border">
          {drawings.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No drawings on this project yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {drawings.map((d) => {
                const isChecked = !!selected[d.drawing_id];
                return (
                  <li key={d.drawing_id} className="flex items-start gap-3 p-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      disabled={!d.eligible || !myRole.isAdmin}
                      checked={isChecked}
                      onCheckedChange={(v) =>
                        setSelected((s) => ({
                          ...s,
                          [d.drawing_id]: Boolean(v),
                        }))
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{d.drawing_number}</span>
                        <span className="truncate font-medium">{d.title}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {d.discipline}
                        </Badge>
                        <Badge
                          variant={d.eligible ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {d.eligible ? "Eligible" : "Blocked"}
                        </Badge>
                        {d.latest_ifd_revision_code && (
                          <span className="text-xs text-muted-foreground">
                            IFD rev {d.latest_ifd_revision_code}
                          </span>
                        )}
                      </div>
                      {d.reasons.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs text-destructive">
                          {d.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {chosen.length} selected · {eligibleIds.length} eligible
          </p>
          <Button
            disabled={!canSubmit || prepare.isPending}
            onClick={() =>
              prepare.mutate(
                {
                  projectId,
                  packageName: packageName.trim(),
                  notes: notes.trim() || undefined,
                  drawingIds: chosen,
                  distribution: [],
                },
                {
                  onSuccess: () => {
                    setSelected({});
                    setNotes("");
                  },
                },
              )
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            Prepare package
          </Button>
        </div>
        {!myRole.isAdmin && (
          <p className="text-xs text-muted-foreground">
            Read-only — engineering_admin or project_admin required to prepare releases.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Release list
// ---------------------------------------------------------------------------
function ReleaseListCard({ projectId }: { projectId: string }) {
  const fn = useServerFn(listIfcReleases);
  const { data: releases } = useSuspenseQuery(ifcReleasesListOptions(fn, projectId));
  const [activeId, setActiveId] = useState<string | null>(releases[0]?.id ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Releases</CardTitle>
        <CardDescription>Prepared, released, and voided packages.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {releases.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Prepare your first IFC package to get started.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {releases.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(r.id);
                    // reflect selection in URL hash for reference
                    if (typeof window !== "undefined") {
                      window.location.hash = `release-${r.id}`;
                    }
                  }}
                  className={
                    "flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-accent " +
                    (activeId === r.id ? "bg-accent" : "")
                  }
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium">{r.package_name}</span>
                    <Badge
                      variant={
                        r.status === "released"
                          ? "default"
                          : r.status === "void"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px] uppercase"
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.revision_snapshot.length} drawing(s) · {r.signoff_count} sign-off(s)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {activeId && <input type="hidden" data-active-release-id={activeId} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Active release panel
// ---------------------------------------------------------------------------
function ActiveReleasePanel({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listIfcReleases);
  const { data: releases } = useSuspenseQuery(ifcReleasesListOptions(listFn, projectId));
  const [activeId, setActiveId] = useState<string | null>(releases[0]?.id ?? null);
  // sync with hash
  useMemo(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash.startsWith("#release-")) {
      const id = hash.slice("#release-".length);
      if (releases.some((r) => r.id === id)) setActiveId(id);
    }
  }, [releases]);

  if (!activeId) return null;
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ReleaseDetail
        key={activeId}
        releaseId={activeId}
        projectId={projectId}
        onChange={setActiveId}
        releases={releases.map((r) => ({ id: r.id, name: r.package_name }))}
      />
    </Suspense>
  );
}

function ReleaseDetail({
  releaseId,
  projectId,
  onChange,
  releases,
}: {
  releaseId: string;
  projectId: string;
  onChange: (id: string) => void;
  releases: Array<{ id: string; name: string }>;
}) {
  const detailFn = useServerFn(getIfcRelease);
  const roleFn = useServerFn(getMyIfcRole);
  const { data } = useSuspenseQuery(ifcReleaseDetailOptions(detailFn, releaseId));
  const { data: myRole } = useSuspenseQuery(myIfcRoleOptions(roleFn, projectId));
  const sign = useSignIfcRelease(releaseId, projectId);
  const release = useReleaseIfc(releaseId, projectId);
  const voidM = useVoidIfcRelease(releaseId, projectId);
  const notify = useNotifyDistribution(releaseId);

  const [role, setRole] = useState<IfcSignoffRoleLabel>("Lead Engineer");
  const [signature, setSignature] = useState(myRole.fullName ?? "");
  const [voidReason, setVoidReason] = useState("");

  const signedRoles = new Set(data.signoffs.map((s) => s.role_label));
  const requiredMissing = (["Lead Engineer", "Engineering Manager"] as const).filter(
    (r) => !signedRoles.has(r),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {data.release.package_name}
            <Badge
              variant={
                data.release.status === "released"
                  ? "default"
                  : data.release.status === "void"
                    ? "destructive"
                    : "secondary"
              }
              className="text-[10px] uppercase"
            >
              {data.release.status}
            </Badge>
            {data.release.status === "released" && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> drawings locked
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Prepared {new Date(data.release.created_at).toLocaleString()}
            {data.release.prepared_by_name ? ` · by ${data.release.prepared_by_name}` : ""}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {releases.length > 1 && (
            <Select value={releaseId} onValueChange={onChange}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {releases.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button asChild variant="outline" size="sm">
            <Link
              to={"/projects/$projectId/engineering/ifc-release/$releaseId/certificate" as any}
              params={{ projectId, releaseId } as any}
              target="_blank"
            >
              Certificate
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Revision snapshot ({data.release.revision_snapshot.length})
          </h3>
          <div className="rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Drawing</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Discipline</th>
                  <th className="px-3 py-2 text-left">Rev</th>
                </tr>
              </thead>
              <tbody>
                {data.release.revision_snapshot.map((r) => (
                  <tr key={r.revision_id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{r.drawing_number}</td>
                    <td className="px-3 py-2">{r.title}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.discipline}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.revision_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Separator />

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" /> Sign-offs
            </h3>
            <ul className="mb-3 flex flex-col gap-1 text-sm">
              {IFC_SIGNOFF_ROLES.map((label) => {
                const s = data.signoffs.find((x) => x.role_label === label);
                const required = label !== "Project Director";
                return (
                  <li
                    key={label}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">
                        {label}{" "}
                        {required && (
                          <span className="text-xs text-muted-foreground">(required)</span>
                        )}
                      </div>
                      {s ? (
                        <div className="text-xs text-muted-foreground">
                          {s.signature_text} · {new Date(s.signed_at).toLocaleString()}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Not signed</div>
                      )}
                    </div>
                    <Badge variant={s ? "default" : "secondary"} className="text-[10px]">
                      {s ? "Signed" : "Pending"}
                    </Badge>
                  </li>
                );
              })}
            </ul>

            {data.release.status === "prepared" && myRole.isAdmin && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <Label className="text-xs">Sign as</Label>
                <Select value={role} onValueChange={(v) => setRole(v as IfcSignoffRoleLabel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IFC_SIGNOFF_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="text-xs">Type your full name</Label>
                <Input
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder={myRole.fullName ?? "Full name"}
                />
                <Button
                  size="sm"
                  disabled={sign.isPending || signature.trim().length < 2}
                  onClick={() =>
                    sign.mutate({
                      releaseId,
                      roleLabel: role,
                      signatureText: signature.trim(),
                    })
                  }
                >
                  Record sign-off
                </Button>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Release actions</h3>
            {data.release.status === "prepared" && (
              <div className="flex flex-col gap-3">
                <Button
                  disabled={!myRole.isAdmin || release.isPending || requiredMissing.length > 0}
                  onClick={() => release.mutate()}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Release IFC package
                </Button>
                {requiredMissing.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Missing: {requiredMissing.join(", ")}
                  </p>
                )}
                <Separator />
                <Label className="text-xs">Void reason</Label>
                <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!myRole.isAdmin || voidM.isPending || voidReason.trim().length < 3}
                  onClick={() => voidM.mutate(voidReason.trim())}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Void prepared package
                </Button>
              </div>
            )}
            {data.release.status === "released" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  Released{" "}
                  {data.release.released_at
                    ? new Date(data.release.released_at).toLocaleString()
                    : ""}{" "}
                  by {data.release.released_by_name ?? "—"}.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={notify.isPending || data.release.distribution_list.length === 0}
                  onClick={() => {
                    if (data.release.distribution_list.length === 0) {
                      toast.info("No distribution recipients configured.");
                      return;
                    }
                    notify.mutate();
                  }}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Notify distribution ({data.release.distribution_list.length})
                </Button>
              </div>
            )}
            {data.release.status === "void" && (
              <p className="text-sm text-muted-foreground">
                Voided{" "}
                {data.release.voided_at ? new Date(data.release.voided_at).toLocaleString() : ""} —{" "}
                {data.release.void_reason}
              </p>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
