// P-124 — API keys admin UI.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  KeyRound,
  Lock,
  Plus,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  updateApiKeySecurity,
  type ApiKeyRow,
  type ApiKeySecurityResult,
  type CreatedKeyResult,
} from "@/lib/api-keys.functions";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/public-api/scopes";


import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/settings/api-keys")({
  component: ApiKeysPage,
  head: () => ({
    meta: [
      { title: "API keys — GridMind EPC" },
      {
        name: "description",
        content: "Create, rotate, and revoke API keys for SCADA and external integrations.",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------

const createFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  scopes: z
    .array(z.string())
    .min(1, "Pick at least one scope")
    .refine(
      (arr) => arr.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s)),
      "Unknown scope",
    ),
  expiresAt: z.string().optional(),
});
type CreateForm = z.infer<typeof createFormSchema>;

function statusBadge(status: ApiKeyRow["status"]) {
  const map: Record<
    ApiKeyRow["status"],
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    active: { label: "Active", variant: "default" },
    expired: { label: "Expired", variant: "secondary" },
    revoked: { label: "Revoked", variant: "destructive" },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ApiKeysPage() {
  const qc = useQueryClient();
  const list = useServerFn(listApiKeys);
  const create = useServerFn(createApiKey);
  const rotate = useServerFn(rotateApiKey);
  const revoke = useServerFn(revokeApiKey);
  const updateSecurity = useServerFn(updateApiKeySecurity);

  const query = useQuery({ queryKey: ["api-keys"], queryFn: () => list() });

  const [createOpen, setCreateOpen] = useState(false);
  const [showRaw, setShowRaw] = useState<{
    raw: string;
    name: string;
    mode: "created" | "rotated" | "hmac";
  } | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState<ApiKeyRow | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<ApiKeyRow | null>(null);
  const [securityKey, setSecurityKey] = useState<ApiKeyRow | null>(null);
  const [ipsDraft, setIpsDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const securityMut = useMutation({
    mutationFn: async (input: {
      keyId: string;
      allowedIps?: string[];
      regenerateHmac?: boolean;
      clearHmac?: boolean;
    }): Promise<ApiKeySecurityResult> => updateSecurity({ data: input }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setSecurityKey(null);
      if (res.hmacSecret) {
        setShowRaw({ raw: res.hmacSecret, name: res.key.name, mode: "hmac" });
      } else {
        toast.success("Key security updated");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update key security"),
  });

  function openSecurity(k: ApiKeyRow) {
    setSecurityKey(k);
    setIpsDraft((k.allowed_ips ?? []).join("\n"));
  }


  const form = useForm<CreateForm>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: "", scopes: [], expiresAt: "" },
  });

  const createMut = useMutation({
    mutationFn: async (input: CreateForm): Promise<CreatedKeyResult> => {
      const expiresAt = input.expiresAt
        ? new Date(input.expiresAt + "T23:59:59Z").toISOString()
        : null;
      return create({
        data: {
          name: input.name,
          scopes: input.scopes as ApiKeyScope[],
          expiresAt,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setCreateOpen(false);
      form.reset();
      setShowRaw({ raw: res.raw, name: res.key.name, mode: "created" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create key"),
  });

  const rotateMut = useMutation({
    mutationFn: async (keyId: string): Promise<CreatedKeyResult> => rotate({ data: { keyId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRotateConfirm(null);
      setShowRaw({ raw: res.raw, name: res.key.name, mode: "rotated" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to rotate key"),
  });

  const revokeMut = useMutation({
    mutationFn: async (keyId: string) => revoke({ data: { keyId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRevokeConfirm(null);
      toast.success("Key revoked");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revoke key"),
  });

  const onSubmit = form.handleSubmit((v) => createMut.mutate(v));

  async function copyRaw() {
    if (!showRaw) return;
    try {
      await navigator.clipboard.writeText(showRaw.raw);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  }

  const isForbidden =
    query.error instanceof Error && /forbidden|401|unauth/i.test(query.error.message);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage keys for SCADA ingestion and external integrations. Keys are shown
            once — store them in a secret manager.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/docs/api" target="_blank" rel="noreferrer">
              <BookOpen className="mr-1.5 h-4 w-4" />
              API docs
            </a>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New key
          </Button>
        </div>
      </div>

      {isForbidden ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldOff className="h-5 w-5" />
              403 — Company admin only
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            API key management is restricted to company administrators. Ask your admin for access if
            you need to integrate an external system.
          </CardContent>
        </Card>
      ) : query.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Could not load API keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{query.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : query.isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ) : query.data && query.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <KeyRound className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No API keys yet</p>
              <p className="text-sm text-muted-foreground">
                Create one to integrate SCADA or external systems.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New key
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>

                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data!.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {k.key_prefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.last_used_at
                        ? formatDistanceToNowStrict(new Date(k.last_used_at), { addSuffix: true })
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.expires_at ? format(new Date(k.expires_at), "yyyy-MM-dd") : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(k.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={k.status === "revoked"}
                          onClick={() => setRotateConfirm(k)}
                        >
                          <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                          Rotate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={k.status === "revoked"}
                          onClick={() => setRevokeConfirm(k)}
                        >
                          <ShieldOff className="mr-1 h-3.5 w-3.5" />
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Create dialog ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Pick the minimum set of scopes this key needs. You can rotate or revoke it at any
              time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. SCADA Ingest — Plant A"
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="rounded-md border p-3">
                {API_KEY_SCOPES.map((scope) => {
                  const checked = form.watch("scopes").includes(scope);
                  return (
                    <label
                      key={scope}
                      className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const cur = form.getValues("scopes");
                          form.setValue(
                            "scopes",
                            v
                              ? Array.from(new Set([...cur, scope]))
                              : cur.filter((s) => s !== scope),
                            { shouldValidate: true },
                          );
                        }}
                      />
                      <code className="font-mono text-xs">{scope}</code>
                    </label>
                  );
                })}
              </div>
              {form.formState.errors.scopes && (
                <p className="text-sm text-destructive">{form.formState.errors.scopes.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiresAt">Expires (optional)</Label>
              <Input id="expiresAt" type="date" {...form.register("expiresAt")} />
              <p className="text-xs text-muted-foreground">
                Leave empty for no expiry. Rotation is preferred over expiry.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- Show-once dialog ---------------- */}
      <Dialog open={!!showRaw} onOpenChange={(o) => !o && setShowRaw(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {showRaw?.mode === "rotated" ? "Key rotated" : "Key created"} — {showRaw?.name}
            </DialogTitle>
            <DialogDescription className="text-destructive">
              Store this now — it will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3">
              <code className="block break-all font-mono text-xs">{showRaw?.raw}</code>
            </div>
            <Button onClick={copyRaw} variant="secondary" className="w-full">
              {copied ? (
                <>
                  <Check className="mr-1.5 h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy to clipboard
                </>
              )}
            </Button>
            {showRaw?.mode === "rotated" && (
              <p className="text-xs text-muted-foreground">
                The previous secret is invalid immediately. Update any integrations using this key.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRaw(null)}>I have saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Rotate confirm ---------------- */}
      <AlertDialog open={!!rotateConfirm} onOpenChange={(o) => !o && setRotateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate “{rotateConfirm?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A new secret will be issued and the current one will stop working immediately. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => rotateConfirm && rotateMut.mutate(rotateConfirm.id)}>
              {rotateMut.isPending ? "Rotating…" : "Rotate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- Revoke confirm ---------------- */}
      <AlertDialog open={!!revokeConfirm} onOpenChange={(o) => !o && setRevokeConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeConfirm?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The key will stop working immediately. Revoked keys stay in the audit trail and cannot
              be reactivated — create a new key instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeConfirm && revokeMut.mutate(revokeConfirm.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMut.isPending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
