import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { useActiveCompany } from "@/components/company-switcher";
import {
  listCompanyMembers,
  grantRole,
  revokeRole,
  type CompanyMemberRow,
  type CompanyMembersResult,
} from "@/lib/roles.functions";
import { DEPARTMENTS, type Department } from "@/lib/permissions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/settings/departments")({
  head: () => ({
    meta: [
      { title: "Departments — GridMind EPC" },
      {
        name: "description",
        content: "Configure the nine GridMind EPC departments and assign their admins.",
      },
      { property: "og:title", content: "Departments — GridMind EPC" },
      {
        property: "og:description",
        content: "Configure the nine GridMind EPC departments and assign their admins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DepartmentsPage,
});

function initialsOf(m: CompanyMemberRow): string {
  const src = (m.fullName ?? m.email ?? "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : src.slice(0, 2);
  return letters.toUpperCase();
}

function displayName(m: CompanyMemberRow): string {
  return m.fullName ?? m.email ?? "Unknown";
}

function DepartmentsPage() {
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const membersFn = useServerFn(listCompanyMembers);
  const grantFn = useServerFn(grantRole);
  const revokeFn = useServerFn(revokeRole);

  const membersKey = ["company-members", activeCompanyId] as const;

  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => membersFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const [pickerFor, setPickerFor] = useState<Department | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isAdmin = membersQuery.data?.isAdmin ?? false;
  const members = membersQuery.data?.members ?? [];

  const applyRoleLocally = (
    userId: string,
    role: Department["adminRole"],
    action: "grant" | "revoke",
  ): CompanyMembersResult | undefined => {
    const snapshot = queryClient.getQueryData<CompanyMembersResult>(membersKey);
    if (!snapshot) return undefined;
    const next: CompanyMembersResult = {
      ...snapshot,
      members: snapshot.members.map((m) => {
        if (m.userId !== userId) return m;
        const has = m.roles.includes(role);
        if (action === "grant" && !has) return { ...m, roles: [...m.roles, role] };
        if (action === "revoke" && has) return { ...m, roles: m.roles.filter((r) => r !== role) };
        return m;
      }),
    };
    queryClient.setQueryData(membersKey, next);
    return snapshot;
  };

  const mutation = useMutation({
    mutationFn: async (vars: {
      targetUserId: string;
      role: Department["adminRole"];
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
      else await revokeFn(payload);
      return vars;
    },
    onMutate: (vars) => {
      setBusyKey(`${vars.role}:${vars.targetUserId}`);
      const snapshot = applyRoleLocally(vars.targetUserId, vars.role, vars.action);
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(membersKey, ctx.snapshot);
      toast.error(err instanceof Error ? err.message : "Update failed");
    },
    onSuccess: (vars) => {
      toast.success(vars.action === "grant" ? "Admin assigned" : "Admin removed");
      queryClient.invalidateQueries({ queryKey: membersKey });
    },
    onSettled: () => setBusyKey(null),
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Departments
        </h1>
        <p className="text-sm text-muted-foreground">
          The nine fixed GridMind EPC departments. Assign one or more admins per department —
          assignments are audit-logged and enforced by the database.
        </p>
      </div>

      {membersQuery.isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {membersQuery.error instanceof Error
            ? membersQuery.error.message
            : "Failed to load members"}
          <Button
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => membersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {membersQuery.isLoading &&
          Array.from({ length: 9 }).map((_, i) => (
            <Card key={`sk-${i}`}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}

        {!membersQuery.isLoading &&
          DEPARTMENTS.map((dept) => {
            const Icon = dept.icon;
            const admins = members.filter((m) => m.roles.includes(dept.adminRole));
            return (
              <Card key={dept.key} className="flex flex-col border-border bg-card">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-display text-base font-semibold text-foreground">
                      {dept.name}
                    </span>
                    <Badge variant="outline" className="mt-1 w-fit font-mono text-[10px]">
                      {dept.adminRole}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <p className="text-sm text-muted-foreground">{dept.responsibilities}</p>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Admins
                    </p>
                    {admins.length === 0 ? (
                      <p className="text-sm text-muted-foreground/80">No admin assigned.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {admins.map((m) => {
                          const key = `${dept.adminRole}:${m.userId}`;
                          const busy = busyKey === key;
                          return (
                            <div
                              key={m.userId}
                              className="inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-2 text-sm"
                            >
                              <Avatar className="h-6 w-6">
                                {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                                <AvatarFallback className="text-[10px]">
                                  {initialsOf(m)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-foreground">{displayName(m)}</span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  disabled={mutation.isPending}
                                  onClick={() =>
                                    mutation.mutate({
                                      targetUserId: m.userId,
                                      role: dept.adminRole,
                                      action: "revoke",
                                    })
                                  }
                                  className="ml-1 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  aria-label={`Remove ${displayName(m)} from ${dept.name}`}
                                >
                                  {busy ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <X className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => setPickerFor(dept)}
                    title={isAdmin ? undefined : "Only company admins can assign department admins"}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Assign admin
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
      </div>

      <AssignAdminDialog
        department={pickerFor}
        members={members}
        onClose={() => setPickerFor(null)}
        onSelect={(userId) => {
          if (!pickerFor) return;
          mutation.mutate({
            targetUserId: userId,
            role: pickerFor.adminRole,
            action: "grant",
          });
          setPickerFor(null);
        }}
      />
    </div>
  );
}

function AssignAdminDialog({
  department,
  members,
  onClose,
  onSelect,
}: {
  department: Department | null;
  members: CompanyMemberRow[];
  onClose: () => void;
  onSelect: (userId: string) => void;
}) {
  const eligible = useMemo(() => {
    if (!department) return [];
    return members.filter((m) => !m.roles.includes(department.adminRole));
  }, [department, members]);

  return (
    <Dialog
      open={department !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4">
          <DialogTitle>Assign {department?.name} admin</DialogTitle>
          <DialogDescription>
            Pick a member to grant{" "}
            <span className="font-mono text-xs">{department?.adminRole}</span>.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList>
            <CommandEmpty>No members available.</CommandEmpty>
            <CommandGroup>
              {eligible.map((m) => (
                <CommandItem
                  key={m.userId}
                  value={`${m.fullName ?? ""} ${m.email ?? ""}`}
                  onSelect={() => onSelect(m.userId)}
                  className="flex items-center gap-3"
                >
                  <Avatar className="h-7 w-7">
                    {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="text-[10px]">{initialsOf(m)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{m.fullName ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{m.email ?? ""}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
