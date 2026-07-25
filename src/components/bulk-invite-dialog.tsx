import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { bulkCreateInvites, type BulkInviteResult } from "@/lib/invites.functions";
import { GRANTABLE_ROLES, humanizeRole, type GrantableRole } from "@/lib/role-groups";
import { Constants } from "@/integrations/supabase/types";

type AppRole = (typeof Constants.public.Enums.app_role)[number];

type RowStatus =
  | "ok"
  | "invalid_email"
  | "unknown_role"
  | "super_admin_forbidden"
  | "duplicate_in_paste"
  | "already_member"
  | "already_pending";

type ParsedRow = {
  id: string;
  email: string;
  role: string;
  status: RowStatus;
  suggestion?: GrantableRole;
};

const emailSchema = z.string().trim().toLowerCase().email();
const roleSet = new Set<string>(Constants.public.Enums.app_role);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function suggestRole(input: string): GrantableRole | undefined {
  if (!input) return undefined;
  let best: GrantableRole | undefined;
  let bestScore = Infinity;
  for (const r of GRANTABLE_ROLES) {
    const s = levenshtein(input, r);
    if (s < bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (bestScore <= Math.max(2, Math.floor(input.length / 2))) return best;
  return undefined;
}

function parseCsv(text: string): Array<{ email: string; role: string }> {
  const out: Array<{ email: string; role: string }> = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const email = parts[0].toLowerCase();
    const role = parts[1].toLowerCase().replace(/\s+/g, "_");
    if (email === "email" && role === "role") continue; // header
    out.push({ email, role });
  }
  return out;
}

function computeStatus(
  row: { email: string; role: string },
  index: number,
  all: Array<{ email: string; role: string }>,
  memberEmails: Set<string>,
  pendingEmails: Set<string>,
): { status: RowStatus; suggestion?: GrantableRole } {
  if (!emailSchema.safeParse(row.email).success) return { status: "invalid_email" };
  if (row.role === "super_admin") return { status: "super_admin_forbidden" };
  if (!roleSet.has(row.role)) {
    return { status: "unknown_role", suggestion: suggestRole(row.role) };
  }
  // Duplicate: any earlier row with same email + role.
  const earlier = all.slice(0, index).some((r) => r.email === row.email && r.role === row.role);
  if (earlier) return { status: "duplicate_in_paste" };
  if (memberEmails.has(row.email)) return { status: "already_member" };
  if (pendingEmails.has(row.email)) return { status: "already_pending" };
  return { status: "ok" };
}

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "Ready",
  invalid_email: "Invalid email",
  unknown_role: "Unknown role",
  super_admin_forbidden: "super_admin not allowed",
  duplicate_in_paste: "Duplicate in paste",
  already_member: "Already a member",
  already_pending: "Already invited",
};

function statusVariant(s: RowStatus) {
  if (s === "ok") return "secondary" as const;
  if (s === "already_member" || s === "already_pending" || s === "duplicate_in_paste")
    return "outline" as const;
  return "destructive" as const;
}

export type BulkInviteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  memberEmails: Set<string>;
  pendingEmails: Set<string>;
  onSuccess: () => void;
};

export function BulkInviteDialog({
  open,
  onOpenChange,
  companyId,
  memberEmails,
  pendingEmails,
  onSuccess,
}: BulkInviteDialogProps) {
  const bulkFn = useServerFn(bulkCreateInvites);

  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [result, setResult] = useState<BulkInviteResult | null>(null);

  const recomputeRows = (list: Array<{ email: string; role: string }>) => {
    return list.map<ParsedRow>((r, i) => {
      const { status, suggestion } = computeStatus(r, i, list, memberEmails, pendingEmails);
      return {
        id: `${i}-${r.email}-${r.role}`,
        email: r.email,
        role: r.role,
        status,
        suggestion,
      };
    });
  };

  const onPreview = () => {
    const parsed = parseCsv(csv);
    if (parsed.length === 0) {
      toast.error("No rows parsed from paste");
      return;
    }
    if (parsed.length > 100) {
      toast.error("Maximum 100 rows per bulk invite");
      return;
    }
    setRows(recomputeRows(parsed));
  };

  const updateRow = (id: string, patch: Partial<Pick<ParsedRow, "email" | "role">>) => {
    setRows((prev) => {
      if (!prev) return prev;
      const list = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      // Recompute all rows against the updated list.
      const plain = list.map((r) => ({ email: r.email, role: r.role }));
      return list.map((r, i) => {
        const { status, suggestion } = computeStatus(
          plain[i],
          i,
          plain,
          memberEmails,
          pendingEmails,
        );
        return { ...r, status, suggestion };
      });
    });
  };

  const okRows = useMemo(() => (rows ?? []).filter((r) => r.status === "ok"), [rows]);

  const mut = useMutation({
    mutationFn: () =>
      bulkFn({
        data: {
          companyId,
          rows: okRows.map((r) => ({ email: r.email, role: r.role as GrantableRole })),
        },
      }),
    onSuccess: (res) => {
      setResult(res);
      onSuccess();
      toast.success(
        `Sent ${res.created.length} · Skipped ${res.skipped.length} · Failed ${res.failed.length}`,
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Bulk invite failed");
    },
  });

  const reset = () => {
    setCsv("");
    setRows(null);
    setResult(null);
    mut.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Bulk invite results</DialogTitle>
              <DialogDescription>
                {result.created.length} sent · {result.skipped.length} skipped ·{" "}
                {result.failed.length} failed
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              {result.created.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Sent</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copy(result.created.map((c) => `${c.email}\t${c.acceptUrl}`).join("\n"))
                      }
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy all links
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableBody>
                        {result.created.map((r) => (
                          <TableRow key={`c-${r.email}`}>
                            <TableCell className="font-medium">{r.email}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {humanizeRole(r.role)}
                            </TableCell>
                            <TableCell>
                              <Input readOnly value={r.acceptUrl} className="h-8" />
                            </TableCell>
                            <TableCell className="w-10">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => copy(r.acceptUrl)}
                                aria-label="Copy link"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
              {result.skipped.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Skipped</h3>
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableBody>
                        {result.skipped.map((r, i) => (
                          <TableRow key={`s-${i}`}>
                            <TableCell className="font-medium">{r.email}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {humanizeRole(r.role)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{r.reason.replace(/_/g, " ")}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
              {result.failed.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-destructive">Failed</h3>
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableBody>
                        {result.failed.map((r, i) => (
                          <TableRow key={`f-${i}`}>
                            <TableCell className="font-medium">{r.email}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {humanizeRole(r.role)}
                            </TableCell>
                            <TableCell className="text-destructive">{r.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Start another
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Bulk invite</DialogTitle>
              <DialogDescription>
                Paste one row per line as{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">email,role</code>. Max 100
                rows.
              </DialogDescription>
            </DialogHeader>
            {rows === null ? (
              <div className="flex flex-col gap-3">
                <Textarea
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                  placeholder={
                    "email,role\nengineer1@example.com,engineer\nlead@example.com,project_admin"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Header row optional. Roles must match app roles (super_admin is not allowed).
                </p>
              </div>
            ) : (
              <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-56">Role</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <Input
                              value={r.email}
                              className="h-8"
                              onChange={(e) =>
                                updateRow(r.id, {
                                  email: e.target.value.trim().toLowerCase(),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={roleSet.has(r.role) ? r.role : undefined}
                              onValueChange={(v) => updateRow(r.id, { role: v })}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder={r.role || "Pick a role"} />
                              </SelectTrigger>
                              <SelectContent>
                                {GRANTABLE_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {humanizeRole(role)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant={statusVariant(r.status)}>
                                {STATUS_LABEL[r.status]}
                              </Badge>
                              {r.status === "unknown_role" && r.suggestion && (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto justify-start p-0 text-xs"
                                  onClick={() =>
                                    updateRow(r.id, {
                                      role: r.suggestion as string,
                                    })
                                  }
                                >
                                  Use {humanizeRole(r.suggestion)}?
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {okRows.length} of {rows.length} rows will be invited.
                </p>
              </div>
            )}
            <DialogFooter>
              {rows === null ? (
                <>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={onPreview} disabled={!csv.trim()}>
                    Preview
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setRows(null)}>
                    Back to paste
                  </Button>
                  <Button
                    type="button"
                    onClick={() => mut.mutate()}
                    disabled={okRows.length === 0 || mut.isPending}
                  >
                    {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send {okRows.length} invite{okRows.length === 1 ? "" : "s"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Silence unused import warnings for AppRole type-only re-export.
export type { AppRole };
