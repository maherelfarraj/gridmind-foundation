import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Minus, X } from "lucide-react";

import { useActiveCompany } from "@/components/company-switcher";
import { listModuleAccess } from "@/lib/modules.functions";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";
import {
  ACTIONS,
  ROLE_MODULE_MAP,
  getActionsFor,
  type Action,
  type ModuleKey,
} from "@/lib/permissions";
import { MODULE_REGISTRY, MODULE_KEYS } from "@/lib/modules";
import { GRANTABLE_ROLES, ROLE_GROUPS, humanizeRole, type GrantableRole } from "@/lib/role-groups";
import { NAV_SECTIONS } from "@/lib/nav-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings/permissions-simulator")({
  head: () => ({
    meta: [
      { title: "Permissions simulator · GridMind EPC" },
      {
        name: "description",
        content: "Preview which modules, routes, and actions a role can access on this tenant.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PermissionsSimulatorPage,
});

const ACTION_LABEL: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  approve: "Approve",
  export: "Export",
};

function PermissionsSimulatorPage() {
  const { activeCompanyId } = useActiveCompany();
  const [primaryRole, setPrimaryRole] = useState<GrantableRole | null>(null);
  const [compareRole, setCompareRole] = useState<GrantableRole | null>(null);
  const [compareOn, setCompareOn] = useState(false);

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });

  const modulesFn = useServerFn(listModuleAccess);
  const modulesQuery = useQuery({
    queryKey: ["modules", activeCompanyId],
    queryFn: () => modulesFn({ data: { companyId: activeCompanyId } }),
    enabled: Boolean(activeCompanyId),
    staleTime: 30_000,
  });

  const isAllowed = useMemo(() => {
    const roles = rolesQuery.data ?? [];
    return roles.some(
      (r) =>
        r.role === "super_admin" ||
        (r.role === "company_admin" && r.company_id === activeCompanyId),
    );
  }, [rolesQuery.data, activeCompanyId]);

  const enabledSet: Set<string> = useMemo(() => {
    if (!modulesQuery.data) return new Set();
    return new Set(modulesQuery.data.modules.filter((m) => m.enabled).map((m) => m.key));
  }, [modulesQuery.data]);

  const planTier = modulesQuery.data?.planTier;

  const rolesToShow: GrantableRole[] = useMemo(() => {
    const out: GrantableRole[] = [];
    if (primaryRole) out.push(primaryRole);
    if (compareOn && compareRole && compareRole !== primaryRole) out.push(compareRole);
    return out;
  }, [primaryRole, compareRole, compareOn]);

  if (rolesQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>
              The permissions simulator is available to company admins and platform super admins.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Permissions simulator
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview only — actual access is enforced by RLS and{" "}
          <span className="font-mono">has_role()</span> on every request.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left panel — role picker */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Preview role</CardTitle>
            <CardDescription>
              Pick a role to see the modules, routes, and actions it can reach on this tenant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Primary role</label>
              <RoleSelect
                value={primaryRole}
                onChange={setPrimaryRole}
                placeholder="Select a role"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Compare with</label>
                {compareOn ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setCompareOn(false);
                      setCompareRole(null);
                    }}
                  >
                    <X className="mr-1 h-3 w-3" /> Clear
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setCompareOn(true)}
                  >
                    Enable compare
                  </Button>
                )}
              </div>
              {compareOn && (
                <RoleSelect
                  value={compareRole}
                  onChange={setCompareRole}
                  placeholder="Select role to compare"
                />
              )}
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">Context</p>
              <div className="flex flex-wrap gap-2">
                {rolesToShow.map((r) => (
                  <Badge key={r} variant="secondary" className="capitalize">
                    {humanizeRole(r)}
                  </Badge>
                ))}
                {planTier && (
                  <Badge variant="outline" className="capitalize">
                    {planTier} plan
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right panel — three stacked cards */}
        <div className="space-y-6">
          {!primaryRole ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No role selected</CardTitle>
                <CardDescription>
                  Pick a role from the left to preview its access on this tenant.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : modulesQuery.isLoading ? (
            <LoadingCards />
          ) : modulesQuery.error ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Couldn't load module access</CardTitle>
                <CardDescription>{(modulesQuery.error as Error).message}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={() => modulesQuery.refetch()}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <VisibleModulesCard roles={rolesToShow} enabledSet={enabledSet} />
              <VisibleRoutesCard roles={rolesToShow} enabledSet={enabledSet} />
              <AllowedActionsCard roles={rolesToShow} enabledSet={enabledSet} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RoleSelect({
  value,
  onChange,
  placeholder,
}: {
  value: GrantableRole | null;
  onChange: (v: GrantableRole) => void;
  placeholder: string;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={(v) => onChange(v as GrantableRole)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {ROLE_GROUPS.map((group) => (
          <SelectGroup key={group.key}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.roles.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">
                {humanizeRole(r)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------

function VisibleModulesCard({
  roles,
  enabledSet,
}: {
  roles: GrantableRole[];
  enabledSet: Set<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visible modules</CardTitle>
        <CardDescription>
          Intersection of the role's module map and this tenant's enabled modules. Modules disabled
          by plan or override still appear, marked as{" "}
          <span className="text-muted-foreground">off by plan</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              {roles.map((r) => (
                <TableHead key={r} className="capitalize">
                  {humanizeRole(r)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULE_KEYS.map((key) => {
              const def = MODULE_REGISTRY[key];
              const tenantEnabled = enabledSet.has(key);
              return (
                <TableRow key={key}>
                  <TableCell>
                    <div className="font-medium text-foreground">{def.label}</div>
                    <div className="text-xs text-muted-foreground">{def.description}</div>
                  </TableCell>
                  {roles.map((r) => {
                    const roleHas = ROLE_MODULE_MAP[r].includes(key);
                    return (
                      <TableCell key={r}>
                        <ModuleCell roleHas={roleHas} tenantEnabled={tenantEnabled} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ModuleCell({ roleHas, tenantEnabled }: { roleHas: boolean; tenantEnabled: boolean }) {
  if (!roleHas) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-4 w-4" />
        <span className="text-xs">Not in role</span>
      </span>
    );
  }
  if (!tenantEnabled) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Check className="h-4 w-4" />
        <span className="text-xs italic">off by plan</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      <Check className="h-4 w-4" />
      <span className="text-xs">Visible</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function VisibleRoutesCard({
  roles,
  enabledSet,
}: {
  roles: GrantableRole[];
  enabledSet: Set<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visible routes</CardTitle>
        <CardDescription>
          Sidebar routes the role would see, filtered by this tenant's enabled modules.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("grid gap-6", roles.length > 1 && "md:grid-cols-2")}>
        {roles.map((role) => (
          <div key={role} className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {humanizeRole(role)}
            </div>
            {NAV_SECTIONS.map((section) => {
              const items = section.items.filter((item) => {
                if (item.requiresSuperAdmin) return false;
                if (item.moduleKey === "admin") {
                  return (
                    role === "company_admin" || role === "billing_admin" || role === "project_admin"
                  );
                }
                const key = item.moduleKey as ModuleKey;
                const roleHas = ROLE_MODULE_MAP[role].includes(key);
                return roleHas && enabledSet.has(key);
              });
              if (items.length === 0) return null;
              return (
                <div key={section.label}>
                  <div className="text-xs font-medium text-muted-foreground">{section.label}</div>
                  <ul className="mt-1 space-y-1">
                    {items.map((item) => (
                      <li key={item.url} className="flex items-center gap-2 text-sm">
                        <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-foreground">{item.label}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {item.url}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function AllowedActionsCard({
  roles,
  enabledSet,
}: {
  roles: GrantableRole[];
  enabledSet: Set<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Allowed actions</CardTitle>
        <CardDescription>
          Per-module action matrix. Department admins get Approve/Export in their own department
          only; external viewers are view-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {roles.map((role) => (
          <div key={role} className="space-y-2">
            {roles.length > 1 && (
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {humanizeRole(role)}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  {ACTIONS.map((a) => (
                    <TableHead key={a} className="text-center">
                      {ACTION_LABEL[a]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {MODULE_KEYS.filter(
                  (k) => ROLE_MODULE_MAP[role].includes(k) && enabledSet.has(k),
                ).map((key) => {
                  const allowed = getActionsFor(role, key);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium text-foreground">
                        {MODULE_REGISTRY[key].label}
                      </TableCell>
                      {ACTIONS.map((a) => (
                        <TableCell key={a} className="text-center">
                          {allowed.includes(a) ? (
                            <Check className="mx-auto h-4 w-4 text-foreground" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {MODULE_KEYS.filter((k) => ROLE_MODULE_MAP[role].includes(k) && enabledSet.has(k))
                  .length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={ACTIONS.length + 1}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No modules visible for this role on this tenant.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ))}
        {/* Reference GRANTABLE_ROLES so the import is retained for future exhaustiveness checks */}
        <span className="hidden" data-role-count={GRANTABLE_ROLES.length} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function LoadingCards() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
