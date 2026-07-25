// P-036 — Wizard step 4: team assignment.
// Project admin (required), members (multi-select w/ search), and 5 optional
// department leads. Semantic tokens only.
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EligibleUser } from "@/lib/projects.functions";
import { DEPT_LEAD_ROLES, type DeptLeadKey, type ProjectTeam } from "@/lib/schemas/project-wizard";

const DEPT_LABELS: Record<DeptLeadKey, string> = {
  engineering: "Engineering",
  procurement: "Procurement",
  construction: "Construction",
  hse: "HSE",
  finance: "Finance",
};

function displayName(u: { full_name: string | null; email: string | null }) {
  return u.full_name?.trim() || u.email || "Unnamed user";
}

export type TeamFormProps = {
  projectAdmins: EligibleUser[];
  members: EligibleUser[];
  deptCandidates: Record<DeptLeadKey, EligibleUser[]>;
  defaultValues?: Partial<ProjectTeam>;
  submitting: boolean;
  onSubmit: (values: ProjectTeam) => void;
  onBack: () => void;
};

export function TeamForm({
  projectAdmins,
  members,
  deptCandidates,
  defaultValues,
  submitting,
  onSubmit,
  onBack,
}: TeamFormProps) {
  const [adminId, setAdminId] = useState<string>(defaultValues?.project_admin_id ?? "");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set(defaultValues?.member_ids ?? []));
  const [deptLeads, setDeptLeads] = useState<Partial<Record<DeptLeadKey, string>>>(
    defaultValues?.dept_leads ?? {},
  );
  const [query, setQuery] = useState("");

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const hay = `${m.full_name ?? ""} ${m.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [members, query]);

  const canSubmit = !!adminId && !submitting;

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminId) return;
    const finalMembers = new Set(memberIds);
    finalMembers.add(adminId); // admin is always a member
    onSubmit({
      project_admin_id: adminId,
      member_ids: Array.from(finalMembers),
      dept_leads: Object.fromEntries(
        Object.entries(deptLeads).filter(([, v]) => !!v),
      ) as ProjectTeam["dept_leads"],
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Project admin */}
      <Card className="flex flex-col gap-3 p-6">
        <div>
          <Label className="text-sm font-medium text-foreground">
            Project admin <span className="text-destructive">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            A project_admin is required before departments can start work.
          </p>
        </div>
        {projectAdmins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No users hold the <code>project_admin</code> role yet. Grant the role in Settings →
            Users, then return here.
          </p>
        ) : (
          <Select value={adminId} onValueChange={setAdminId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Choose a project admin" />
            </SelectTrigger>
            <SelectContent>
              {projectAdmins.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {displayName(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Card>

      {/* Members */}
      <Card className="flex flex-col gap-3 p-6">
        <div>
          <Label className="text-sm font-medium text-foreground">Members</Label>
          <p className="text-xs text-muted-foreground">The project admin is added automatically.</p>
        </div>
        <div className="relative max-w-md">
          <Search
            size={16}
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="pl-8"
          />
        </div>
        <div className="max-h-72 overflow-auto rounded-md border border-border">
          {filteredMembers.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matching users.</p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredMembers.map((u) => {
                const isAdmin = u.id === adminId;
                const checked = isAdmin || memberIds.has(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`m-${u.id}`}
                      checked={checked}
                      disabled={isAdmin}
                      onCheckedChange={() => toggleMember(u.id)}
                    />
                    <label
                      htmlFor={`m-${u.id}`}
                      className="flex flex-1 cursor-pointer flex-col text-sm"
                    >
                      <span className="text-foreground">{displayName(u)}</span>
                      {u.email && u.full_name ? (
                        <span className="text-xs text-muted-foreground">{u.email}</span>
                      ) : null}
                    </label>
                    {isAdmin ? (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Admin
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* Department leads */}
      <Card className="flex flex-col gap-4 p-6">
        <div>
          <Label className="text-sm font-medium text-foreground">Department leads</Label>
          <p className="text-xs text-muted-foreground">Optional. Leave blank to assign later.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DEPT_LEAD_ROLES.map((dept) => {
            const options = deptCandidates[dept] ?? [];
            const value = deptLeads[dept] ?? "";
            return (
              <div key={dept} className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">{DEPT_LABELS[dept]}</Label>
                <Select
                  value={value || "__none__"}
                  onValueChange={(v) =>
                    setDeptLeads((prev) => ({
                      ...prev,
                      [dept]: v === "__none__" ? undefined : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={options.length === 0 ? "No eligible users" : "Assign later"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Assign later</SelectItem>
                    {options.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {displayName(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </Card>

      <footer className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
          Back
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            "Finish & create project"
          )}
        </Button>
      </footer>
    </form>
  );
}
