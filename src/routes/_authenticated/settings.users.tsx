import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";

import {
  createInvite,
  getCompanyAdminSnapshot,
  listInvites,
  resendInvite,
  revokeInvite,
} from "@/lib/invites.functions";
import {
  grantRole,
  listCompanyMembers,
  revokeRole,
  type CompanyMemberRow,
  type CompanyMembersResult,
} from "@/lib/roles.functions";
import { GRANTABLE_ROLES, ROLE_GROUPS, humanizeRole, type GrantableRole } from "@/lib/role-groups";
import { Constants } from "@/integrations/supabase/types";
import { useActiveCompany } from "@/components/company-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkInviteDialog } from "@/components/bulk-invite-dialog";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/settings/users")({
  head: () => ({
    meta: [
      { title: "Users | GridMind EPC" },
      {
        name: "description",
        content: "Manage members, roles, and pending invitations for your GridMind EPC workspace.",
      },
      { property: "og:title", content: "Users | GridMind EPC" },
      {
        property: "og:description",
        content: "Manage members, roles, and pending invitations for your GridMind EPC workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UsersPage,
});

const INVITE_ROLE_OPTIONS = Constants.public.Enums.app_role.filter((r) => r !== "super_admin");

const formSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(Constants.public.Enums.app_role),
});
type FormValues = z.infer<typeof formSchema>;

function statusVariant(status: string) {
  switch (status) {
    case "pending":
      return "default" as const;
    case "accepted":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function initialsOf(m: CompanyMemberRow): string {
  const src = m.fullName?.trim() || m.email?.trim() || "?";
  const parts = src.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function toCsv(rows: CompanyMemberRow[]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["Name", "Email", "Roles"].map(escape).join(",")];
  for (const r of rows) {
    lines.push([r.fullName ?? "", r.email ?? "", r.roles.join("|")].map(escape).join(","));
  }
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function UsersPage() {
  const { t } = useI18n();
  const { activeCompanyId } = useActiveCompany();
  const roleLabel = (role: string) => {
    const key = `adminMod.settings.roles.${role}`;
    const label = t(key);
    return label === key ? humanizeRole(role as GrantableRole) : label;
  };
  const queryClient = useQueryClient();
  const listFn = useServerFn(listInvites);
  const snapshotFn = useServerFn(getCompanyAdminSnapshot);
  const membersFn = useServerFn(listCompanyMembers);
  const createFn = useServerFn(createInvite);
  const revokeFn = useServerFn(revokeInvite);
  const resendFn = useServerFn(resendInvite);
  const grantFn = useServerFn(grantRole);
  const revokeRoleFn = useServerFn(revokeRole);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [manageUserId, setManageUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<GrantableRole | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"members" | "invitations">("members");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteFilter, setInviteFilter] = useState<
    "all" | "pending" | "accepted" | "expired" | "revoked"
  >("all");

  const membersKey = ["company-members", activeCompanyId] as const;

  const snapshotQuery = useQuery({
    queryKey: ["company-admin-snapshot", activeCompanyId],
    queryFn: () => snapshotFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => membersFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const invitesQuery = useQuery({
    queryKey: ["invites", activeCompanyId],
    queryFn: () => listFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invites", activeCompanyId] });
    queryClient.invalidateQueries({
      queryKey: ["company-admin-snapshot", activeCompanyId],
    });
    queryClient.invalidateQueries({ queryKey: membersKey });
  };

  const createMut = useMutation({
    mutationFn: (vars: FormValues) =>
      createFn({
        data: {
          companyId: activeCompanyId!,
          email: vars.email,
          role: vars.role,
        },
      }),
    onSuccess: (result) => {
      setIssuedLink(result.acceptUrl);
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("adminMod.settings.couldNotCreateInvite"));
    },
  });

  const revokeMut = useMutation({
    mutationFn: (inviteId: string) => revokeFn({ data: { inviteId } }),
    onSuccess: () => {
      toast.success(t("adminMod.settings.inviteRevokedToast"));
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("adminMod.settings.couldNotRevokeInvite"));
    },
  });

  const resendMut = useMutation({
    mutationFn: (inviteId: string) => resendFn({ data: { inviteId } }),
    onSuccess: (result) => {
      setIssuedLink(result.acceptUrl);
      setDialogOpen(true);
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("adminMod.settings.couldNotResendInvite"));
    },
  });

  const applyRoleLocally = (
    targetUserId: string,
    role: GrantableRole,
    action: "grant" | "revoke",
  ) => {
    const prev = queryClient.getQueryData<CompanyMembersResult>(membersKey);
    if (!prev) return prev;
    const next: CompanyMembersResult = {
      ...prev,
      members: prev.members.map((m) => {
        if (m.userId !== targetUserId) return m;
        const set = new Set(m.roles);
        if (action === "grant") set.add(role);
        else set.delete(role);
        return { ...m, roles: Array.from(set) };
      }),
    };
    queryClient.setQueryData(membersKey, next);
    return prev;
  };

  const roleMut = useMutation({
    mutationFn: async (vars: {
      targetUserId: string;
      role: GrantableRole;
      action: "grant" | "revoke";
    }) => {
      const payload = {
        data: {
          companyId: activeCompanyId!,
          targetUserId: vars.targetUserId,
          role: vars.role,
        },
      };
      if (vars.action === "grant") await grantFn(payload);
      else await revokeRoleFn(payload);
      return vars;
    },
    onMutate: (vars) => {
      setPendingRole(vars.role);
      const snapshot = applyRoleLocally(vars.targetUserId, vars.role, vars.action);
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(membersKey, ctx.snapshot);
      toast.error(err instanceof Error ? err.message : t("adminMod.settings.roleUpdateFailed"));
    },
    onSuccess: (vars) => {
      toast.success(
        vars.action === "grant"
          ? t("adminMod.settings.grantedRoleToast", { role: roleLabel(vars.role) })
          : t("adminMod.settings.revokedRoleToast", { role: roleLabel(vars.role) }),
      );
      queryClient.invalidateQueries({ queryKey: membersKey });
      queryClient.invalidateQueries({
        queryKey: ["company-admin-snapshot", activeCompanyId],
      });
    },
    onSettled: () => setPendingRole(null),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", role: "engineer" },
  });

  const isAdmin = membersQuery.data?.isAdmin ?? snapshotQuery.data?.isAdmin ?? false;
  const adminCount = membersQuery.data?.adminCount ?? snapshotQuery.data?.adminCount ?? 0;
  const members = membersQuery.data?.members ?? [];
  const invites = invitesQuery.data ?? [];

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.fullName ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, search]);

  const memberEmails = useMemo(
    () => new Set(members.map((m) => (m.email ?? "").toLowerCase()).filter((e) => e.length > 0)),
    [members],
  );
  const pendingEmails = useMemo(
    () => new Set(invites.filter((i) => i.status === "pending").map((i) => i.email.toLowerCase())),
    [invites],
  );

  const derivedInvites = useMemo(
    () =>
      invites.map((i) => {
        const isExpired = i.status === "pending" && new Date(i.expires_at).getTime() < Date.now();
        return {
          ...i,
          derivedStatus: isExpired
            ? ("expired" as const)
            : (i.status as "pending" | "accepted" | "expired" | "revoked"),
        };
      }),
    [invites],
  );

  const filteredInvites = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase();
    return derivedInvites.filter((i) => {
      if (inviteFilter !== "all" && i.derivedStatus !== inviteFilter) return false;
      if (q && !i.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [derivedInvites, inviteSearch, inviteFilter]);

  const managedMember = useMemo(
    () => members.find((m) => m.userId === manageUserId) ?? null,
    [members, manageUserId],
  );

  const onSubmit = (values: FormValues) => createMut.mutate(values);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("adminMod.settings.inviteLinkCopied"));
    } catch {
      toast.error(t("adminMod.settings.couldNotCopyLink"));
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setIssuedLink(null);
    createMut.reset();
    form.reset();
  };

  const onExport = () => {
    if (members.length === 0) {
      toast.error(t("adminMod.settings.noMembersToExport"));
      return;
    }
    downloadCsv("members.csv", toCsv(members));
  };

  return (
    <div className="page-shell max-w-5xl">
      <PageHeader
        title="Users"
        description="Workspace members, roles, and pending invitations."
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setBulkOpen(true)}>
                <UsersIcon className="mr-2 h-4 w-4" />
                Bulk invite
              </Button>
              <Dialog
                open={dialogOpen}
                onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
              >
                <DialogTrigger asChild>
                  <Button>Invite member</Button>
                </DialogTrigger>
                <DialogContent>
                  {issuedLink ? (
                    <>
                      <DialogHeader>
                        <DialogTitle>Invitation link</DialogTitle>
                        <DialogDescription>
                          Share this link with the recipient. It will only be shown once.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={issuedLink} />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => copyLink(issuedLink)}
                          aria-label="Copy link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <DialogFooter>
                        <Button type="button" onClick={closeDialog}>
                          I&apos;ve shared it
                        </Button>
                      </DialogFooter>
                    </>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle>Invite a teammate</DialogTitle>
                        <DialogDescription>
                          They&apos;ll receive a one-time link to join{" "}
                          {snapshotQuery.data ? "your company" : "the workspace"}.
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                  <Input
                                    type="email"
                                    placeholder="teammate@company.com"
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
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select a role" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {INVITE_ROLE_OPTIONS.map((role) => (
                                      <SelectItem key={role} value={role}>
                                        {roleLabel(role)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <DialogFooter>
                            <Button type="submit" disabled={createMut.isPending}>
                              {createMut.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              Create invite
                            </Button>
                          </DialogFooter>
                        </form>
                      </Form>
                    </>
                  )}
                </DialogContent>
              </Dialog>
              {activeCompanyId ? (
                <BulkInviteDialog
                  open={bulkOpen}
                  onOpenChange={setBulkOpen}
                  companyId={activeCompanyId}
                  memberEmails={memberEmails}
                  pendingEmails={pendingEmails}
                  onSuccess={invalidate}
                />
              ) : null}
            </div>
          )
        }
      />

      {membersQuery.data && adminCount === 1 && (
        <div className="flex items-start gap-3 rounded-lg border border-accent bg-accent/40 p-4 text-accent-foreground">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Only one company admin</p>
            <p className="text-accent-foreground/80">
              We recommend at least 2 company admins to avoid lockout.
            </p>
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "members" | "invitations")}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations
            {invites.filter((i) => i.status === "pending").length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {invites.filter((i) => i.status === "pending").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              className="h-9 w-64"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={membersQuery.isLoading || members.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersQuery.isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell>
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-40" />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                {membersQuery.isError && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-destructive">
                      {membersQuery.error instanceof Error
                        ? membersQuery.error.message
                        : "Failed to load members"}
                    </TableCell>
                  </TableRow>
                )}
                {membersQuery.data && filteredMembers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="border-0 bg-transparent p-0">
                      <EmptyState
                        icon={UsersIcon}
                        title={
                          members.length === 0 ? "No members yet" : "No members match your search"
                        }
                        compact
                        className="border-0 bg-transparent"
                      />
                    </TableCell>
                  </TableRow>
                )}
                {filteredMembers.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <Avatar className="h-8 w-8">
                        {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                        <AvatarFallback>{initialsOf(m)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">{m.fullName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.length === 0 && (
                          <span className="text-xs text-muted-foreground">No roles</span>
                        )}
                        {m.roles.map((r) => (
                          <Badge key={r} variant="outline">
                            {roleLabel(r)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {isAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setManageUserId(m.userId)}
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          Manage roles
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="invitations" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Input
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Search by email"
              className="h-9 w-64"
            />
            <Select
              value={inviteFilter}
              onValueChange={(v) =>
                setInviteFilter(v as "all" | "pending" | "accepted" | "expired" | "revoked")
              }
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Loading invites…
                    </TableCell>
                  </TableRow>
                )}
                {invitesQuery.isError && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-destructive">
                      {invitesQuery.error instanceof Error
                        ? invitesQuery.error.message
                        : "Failed to load invites"}
                    </TableCell>
                  </TableRow>
                )}
                {invitesQuery.data && filteredInvites.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="border-0 bg-transparent p-0">
                      <EmptyState
                        icon={Mail}
                        title={
                          invites.length === 0
                            ? "No invites sent yet"
                            : "No invites match your filter"
                        }
                        compact
                        className="border-0 bg-transparent"
                      />
                    </TableCell>
                  </TableRow>
                )}
                {filteredInvites.map((row) => {
                  const canAct = row.derivedStatus === "pending";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {roleLabel(row.role)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.derivedStatus)}>
                          {row.derivedStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(row.expires_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!isAdmin || !canAct || resendMut.isPending}
                            onClick={() => resendMut.mutate(row.id)}
                            aria-label="Resend"
                          >
                            {resendMut.isPending && resendMut.variables === row.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!isAdmin || !canAct || revokeMut.isPending}
                            onClick={() => revokeMut.mutate(row.id)}
                            aria-label="Revoke"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet
        open={manageUserId !== null}
        onOpenChange={(open) => {
          if (!open) setManageUserId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              Manage roles
              {managedMember && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · {managedMember.fullName ?? managedMember.email ?? ""}
                </span>
              )}
            </SheetTitle>
            <SheetDescription>
              Toggle roles for this member. Changes are audit-logged and enforced by the database.
            </SheetDescription>
          </SheetHeader>
          {managedMember && (
            <div className="mt-6 flex flex-col gap-6">
              {ROLE_GROUPS.map((group) => (
                <div key={group.key} className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {group.roles.map((role) => {
                      const on = managedMember.roles.includes(role);
                      const busy = roleMut.isPending && pendingRole === role;
                      return (
                        <label
                          key={role}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
                        >
                          <span className="capitalize text-foreground">{roleLabel(role)}</span>
                          <div className="flex items-center gap-2">
                            {busy && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={on}
                              disabled={roleMut.isPending}
                              onCheckedChange={(next) =>
                                roleMut.mutate({
                                  targetUserId: managedMember.userId,
                                  role,
                                  action: next ? "grant" : "revoke",
                                })
                              }
                              aria-label={`${on ? "Revoke" : "Grant"} ${roleLabel(role)}`}
                            />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {GRANTABLE_ROLES.length} roles available. super_admin can only be granted by another
                super_admin at the database level.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
