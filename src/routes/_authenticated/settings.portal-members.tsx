// P-114 — Portal admin: /settings/portal-members.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import {
  Activity,
  Ban,
  Clock,
  Copy,
  Loader2,
  Mail,
  PauseCircle,
  Play,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import {
  DEFAULT_EXPOSURE,
  EXPOSURE_KEYS,
  invitePortalMember,
  listAdminProjects,
  listPortalMembers,
  reactivatePortalMember,
  revokePortalMember,
  suspendPortalMember,
  updatePortalMemberExposure,
  type PortalExposure,
  type PortalMemberAdminRow,
  type PortalRole,
} from "@/lib/portal.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/settings/portal-members")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Portal members — GridMind EPC" },
      {
        name: "description",
        content: "Manage external client, investor, and lender access to project portals.",
      },
    ],
  }),
  component: PortalMembersPage,
});

// -----------------------------------------------------------------------------

const ROLES: Array<{ value: PortalRole; label: string }> = [
  { value: "client_viewer", label: "Client viewer" },
  { value: "investor_viewer", label: "Investor viewer" },
  { value: "lender_viewer", label: "Lender viewer" },
];

const EXPOSURE_LABELS: Record<keyof PortalExposure, string> = {
  milestones: "Milestones",
  kpis: "KPIs",
  photos: "Photos",
  documents: "Documents",
  financials: "Financials",
  tickets: "Tickets",
  approvals: "Approvals",
};

function statusBadge(status: PortalMemberAdminRow["status"]) {
  const map: Record<PortalMemberAdminRow["status"], string> = {
    invited: "bg-accent text-accent-foreground",
    active: "bg-primary/15 text-primary",
    suspended: "bg-muted text-muted-foreground",
    revoked: "bg-destructive/15 text-destructive",
  };
  return <Badge className={map[status]}>{status}</Badge>;
}

function roleLabel(role: PortalRole) {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

// -----------------------------------------------------------------------------

function PortalMembersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const listProjectsFn = useServerFn(listAdminProjects);
  const listMembersFn = useServerFn(listPortalMembers);

  const projectsQuery = useQuery({
    queryKey: ["portal-admin", "projects"],
    queryFn: () => listProjectsFn(),
  });

  const projects = projectsQuery.data ?? [];
  const projectId =
    search.projectId && projects.some((p) => p.id === search.projectId)
      ? search.projectId
      : projects[0]?.id;

  const membersQuery = useQuery({
    queryKey: ["portal-admin", "members", projectId ?? "none"],
    queryFn: () => listMembersFn({ data: { projectId: projectId as string } }),
    enabled: Boolean(projectId),
  });

  return (
    <div className="page-shell">
      <PageHeader
        title="Portal members"
        description="Invite external clients, investors, and lenders to a curated project portal."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Project
        </label>
        <Select
          value={projectId ?? ""}
          onValueChange={(v) => navigate({ search: { projectId: v } })}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a project…" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">{projectId ? <InviteDialog projectId={projectId} /> : null}</div>
      </div>

      {membersQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : membersQuery.error ? (
        <EmptyState
          icon={ShieldAlert}
          title="Could not load portal members"
          description="Refresh to retry."
        />
      ) : !projectId ? (
        <EmptyState
          icon={Mail}
          title="No projects yet"
          description="Create a project first, then invite external portal members."
        />
      ) : (membersQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No portal members yet"
          description="Invite a client, investor, or lender to see this project's curated portal."
        />
      ) : (
        <MembersTable projectId={projectId} rows={membersQuery.data ?? []} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Members table
// -----------------------------------------------------------------------------

function MembersTable({ projectId, rows }: { projectId: string; rows: PortalMemberAdminRow[] }) {
  const qc = useQueryClient();
  const suspendFn = useServerFn(suspendPortalMember);
  const revokeFn = useServerFn(revokePortalMember);
  const reactivateFn = useServerFn(reactivatePortalMember);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["portal-admin", "members", projectId] });

  const suspendMut = useMutation({
    mutationFn: (id: string) => suspendFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Member suspended");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Access revoked");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reactivateMut = useMutation({
    mutationFn: (id: string) => reactivateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Access reactivated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Exposure</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">{row.email}</TableCell>
              <TableCell className="text-sm">{roleLabel(row.role)}</TableCell>
              <TableCell>{statusBadge(row.status)}</TableCell>
              <TableCell>
                <ExposureChips projectId={projectId} memberId={row.id} exposure={row.exposure} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.last_seen_at
                  ? formatDistanceToNow(new Date(row.last_seen_at), {
                      addSuffix: true,
                    })
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.expires_at ? format(new Date(row.expires_at), "PP") : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/settings/portal-audit" search={{ membershipId: row.id, projectId }}>
                      <Activity className="mr-1 h-3.5 w-3.5" />
                      Activity
                    </Link>
                  </Button>
                  {row.status === "active" || row.status === "invited" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={suspendMut.isPending}
                      onClick={() => suspendMut.mutate(row.id)}
                    >
                      <PauseCircle className="mr-1 h-3.5 w-3.5" />
                      Suspend
                    </Button>
                  ) : row.status === "suspended" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reactivateMut.isPending}
                      onClick={() => reactivateMut.mutate(row.id)}
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Reactivate
                    </Button>
                  ) : null}
                  {row.status !== "revoked" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={revokeMut.isPending}
                      onClick={() => revokeMut.mutate(row.id)}
                    >
                      <Ban className="mr-1 h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ExposureChips({
  projectId,
  memberId,
  exposure,
}: {
  projectId: string;
  memberId: string;
  exposure: PortalExposure;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePortalMemberExposure);
  const [local, setLocal] = useState(exposure);
  const mut = useMutation({
    mutationFn: (next: PortalExposure) => updateFn({ data: { id: memberId, exposure: next } }),
    onSuccess: () => {
      toast.success("Exposure updated");
      qc.invalidateQueries({ queryKey: ["portal-admin", "members", projectId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setLocal(exposure);
    },
  });
  const presets: Array<{ label: string; exposure: PortalExposure }> = [
    {
      label: "Milestones only",
      exposure: {
        ...DEFAULT_EXPOSURE,
        milestones: true,
        kpis: false,
        photos: false,
        documents: false,
        financials: false,
        tickets: false,
        approvals: false,
      },
    },
    {
      label: "Milestones + KPIs",
      exposure: {
        ...DEFAULT_EXPOSURE,
        milestones: true,
        kpis: true,
        photos: false,
        documents: false,
        financials: false,
        tickets: false,
        approvals: false,
      },
    },
    {
      label: "Full read-only",
      exposure: {
        milestones: true,
        kpis: true,
        photos: true,
        documents: true,
        financials: true,
        tickets: true,
        approvals: true,
      },
    },
  ];
  function applyPreset(next: PortalExposure) {
    setLocal(next);
    mut.mutate(next);
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          {EXPOSURE_KEYS.map((k) => {
            const on = local[k];
            return (
              <Tooltip key={k}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={mut.isPending}
                    onClick={() => {
                      const next = { ...local, [k]: !on };
                      setLocal(next);
                      mut.mutate(next);
                    }}
                    className={
                      "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition " +
                      (on
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground opacity-60 hover:opacity-100")
                    }
                  >
                    {EXPOSURE_LABELS[k]}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{on ? "Visible" : "Hidden"} · click to toggle</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={mut.isPending}
              onClick={() => applyPreset(p.exposure)}
              className="rounded border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

// -----------------------------------------------------------------------------
// Invite dialog
// -----------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["client_viewer", "investor_viewer", "lender_viewer"]),
  milestones: z.boolean(),
  kpis: z.boolean(),
  photos: z.boolean(),
  documents: z.boolean(),
  financials: z.boolean(),
  tickets: z.boolean(),
  approvals: z.boolean(),
});
type InviteFormValues = z.infer<typeof inviteSchema>;

function InviteDialog({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const inviteFn = useServerFn(invitePortalMember);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: "client_viewer",
      ...DEFAULT_EXPOSURE,
    },
  });

  const mut = useMutation({
    mutationFn: (values: InviteFormValues) =>
      inviteFn({
        data: {
          projectId,
          email: values.email,
          role: values.role,
          exposure: {
            milestones: values.milestones,
            kpis: values.kpis,
            photos: values.photos,
            documents: values.documents,
            financials: values.financials,
            tickets: values.tickets,
            approvals: values.approvals,
          },
        },
      }),
    onSuccess: (res) => {
      toast.success("Invitation created");
      setResult({ token: res.token, expiresAt: res.expires_at });
      qc.invalidateQueries({ queryKey: ["portal-admin", "members", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteLink = useMemo(() => {
    if (!result || typeof window === "undefined") return null;
    return `${window.location.origin}/accept-invite?token=${result.token}`;
  }, [result]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          form.reset({
            email: "",
            role: "client_viewer",
            ...DEFAULT_EXPOSURE,
          });
          setResult(null);
        }
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" />
        Invite portal member
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite portal member</DialogTitle>
          <DialogDescription>
            External accounts receive a curated read-only portal. Invite expires in 7 days.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Invite expires {format(new Date(result.expiresAt), "PPP p")}
              </div>
              <div className="break-all font-mono text-xs">{inviteLink}</div>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                if (inviteLink) {
                  navigator.clipboard.writeText(inviteLink);
                  toast.success("Link copied");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy invite link
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="client@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <div className="mb-2 text-sm font-medium">Exposure</div>
                <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
                  {EXPOSURE_KEYS.map((k) => (
                    <FormField
                      key={k}
                      control={form.control}
                      name={k}
                      render={({ field }) => (
                        <div className="flex items-center justify-between gap-2">
                          <FormLabel className="mb-0 text-sm">{EXPOSURE_LABELS[k]}</FormLabel>
                          <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                        </div>
                      )}
                    />
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mut.isPending}>
                  {mut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
