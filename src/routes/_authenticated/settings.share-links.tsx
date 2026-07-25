// P-115 — Admin UI for investor/lender share links.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNowStrict, format } from "date-fns";
import { Ban, Check, Copy, Link as LinkIcon, ShieldAlert } from "lucide-react";

import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  SHARE_ROLES,
  SHARE_SECTIONS,
  EXPIRY_PRESETS,
  type ExpiryPreset,
  type ShareLinkAdminRow,
  type ShareRole,
  type ShareSection,
} from "@/lib/share-links.functions";
import { listAdminProjects } from "@/lib/portal.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/_authenticated/settings/share-links")({
  head: () => ({
    meta: [
      { title: "Share links — GridMind EPC" },
      {
        name: "description",
        content:
          "Create tokenized, expiring, revocable investor and lender views of project progress.",
      },
    ],
  }),
  component: ShareLinksPage,
});

const ROLE_LABELS: Record<ShareRole, string> = {
  investor_viewer: "Investor viewer",
  lender_viewer: "Lender viewer",
};

const SECTION_LABELS: Record<ShareSection, string> = {
  kpis: "KPIs",
  milestones: "Milestones",
  photos: "Photos",
  financials: "Financials",
};

const EXPIRY_LABELS: Record<ExpiryPreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

// ---------------------------------------------------------------------------

function ShareLinksPage() {
  const listFn = useServerFn(listShareLinks);
  const listQuery = useQuery({
    queryKey: ["share-links"],
    queryFn: () => listFn(),
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Share links
        </h1>
        <p className="text-sm text-muted-foreground">
          Tokenized, expiring, revocable read-only views for investors and lenders.
          The URL is shown once at creation — save it before closing the dialog.
        </p>
      </header>

      <div className="flex items-center justify-end">
        <CreateLinkDialog />
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : listQuery.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <ShieldAlert className="mb-2 h-5 w-5" />
          Could not load share links.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-destructive underline"
            onClick={() => listQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (listQuery.data ?? []).length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <LinkIcon className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">
            No share links yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first investor or lender view above.
          </p>
        </div>
      ) : (
        <LinksTable rows={listQuery.data ?? []} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function statusBadge(status: ShareLinkAdminRow["status"]) {
  const map = {
    active: "bg-primary/15 text-primary",
    expired: "bg-muted text-muted-foreground",
    revoked: "bg-destructive/15 text-destructive",
  } as const;
  return <Badge className={map[status]}>{status}</Badge>;
}

function LinksTable({ rows }: { rows: ShareLinkAdminRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Projects</TableHead>
            <TableHead>Sections</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Views</TableHead>
            <TableHead>Last accessed</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell>{ROLE_LABELS[r.role]}</TableCell>
              <TableCell>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm text-muted-foreground underline decoration-dotted">
                        {r.project_names.length} project
                        {r.project_names.length === 1 ? "" : "s"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <ul className="text-xs">
                        {r.project_names.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {r.scope.sections.map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {SECTION_LABELS[s]}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {r.status === "expired"
                  ? `Expired ${formatDistanceToNowStrict(new Date(r.expires_at), { addSuffix: true })}`
                  : `in ${formatDistanceToNowStrict(new Date(r.expires_at))}`}
              </TableCell>
              <TableCell>{r.access_count}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {r.last_accessed_at
                  ? format(new Date(r.last_accessed_at), "PP p")
                  : "—"}
              </TableCell>
              <TableCell>{statusBadge(r.status)}</TableCell>
              <TableCell className="text-right">
                {r.status === "active" ? <RevokeButton id={r.id} label={r.label} /> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RevokeButton({ id, label }: { id: string; label: string }) {
  const qc = useQueryClient();
  const revokeFn = useServerFn(revokeShareLink);
  const mut = useMutation({
    mutationFn: () => revokeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Link revoked");
      qc.invalidateQueries({ queryKey: ["share-links"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Ban className="mr-2 h-4 w-4" />
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this share link?</AlertDialogTitle>
          <AlertDialogDescription>
            "{label}" will stop working immediately. Anyone visiting the URL
            will see a "Link revoked" page. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

const createFormSchema = z.object({
  label: z.string().trim().min(3, "At least 3 characters").max(120),
  role: z.enum(SHARE_ROLES),
  projectIds: z.array(z.string().uuid()).min(1, "Pick at least one project"),
  sections: z.array(z.enum(SHARE_SECTIONS)).min(1, "Pick at least one section"),
  expiresPreset: z.enum(EXPIRY_PRESETS),
});

type CreateFormValues = z.infer<typeof createFormSchema>;

function CreateLinkDialog() {
  const [open, setOpen] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const qc = useQueryClient();
  const listProjectsFn = useServerFn(listAdminProjects);
  const createFn = useServerFn(createShareLink);

  const projectsQuery = useQuery({
    queryKey: ["share-links", "projects"],
    queryFn: () => listProjectsFn(),
    enabled: open,
  });

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      label: "",
      role: "investor_viewer",
      projectIds: [],
      sections: ["kpis", "milestones"],
      expiresPreset: "30d",
    },
  });

  const role = form.watch("role");
  const sections = form.watch("sections");

  const createMut = useMutation({
    mutationFn: (values: CreateFormValues) => createFn({ data: values }),
    onSuccess: (res) => {
      setCreatedUrl(res.url);
      qc.invalidateQueries({ queryKey: ["share-links"] });
      form.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(values: CreateFormValues) {
    const cleaned =
      values.role === "lender_viewer"
        ? values
        : { ...values, sections: values.sections.filter((s) => s !== "financials") };
    if (cleaned.sections.length === 0) {
      form.setError("sections", { message: "Pick at least one section" });
      return;
    }
    createMut.mutate(cleaned);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreatedUrl(null);
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <LinkIcon className="mr-2 h-4 w-4" />
        Create link
      </Button>
      <DialogContent className="max-w-lg">
        {createdUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Share link created</DialogTitle>
              <DialogDescription>
                This URL is shown once — save it now. We only store its hash.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <code className="flex-1 truncate text-xs">{createdUrl}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(createdUrl).then(
                    () => toast.success("Copied"),
                    () => toast.error("Copy failed"),
                  );
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>
                <Check className="mr-2 h-4 w-4" />
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create share link</DialogTitle>
              <DialogDescription>
                Curated, revocable, expiring read-only access — no account needed.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Label</FormLabel>
                      <FormControl>
                        <Input placeholder="Q3 Investor Update" {...field} />
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
                      <FormLabel>Audience</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SHARE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="projectIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Projects</FormLabel>
                      <div className="max-h-40 overflow-auto rounded-md border border-border p-2">
                        {projectsQuery.isLoading ? (
                          <p className="p-2 text-xs text-muted-foreground">Loading…</p>
                        ) : (projectsQuery.data ?? []).length === 0 ? (
                          <p className="p-2 text-xs text-muted-foreground">
                            No projects available.
                          </p>
                        ) : (
                          (projectsQuery.data ?? []).map((p) => {
                            const checked = field.value.includes(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => {
                                    const next = v
                                      ? [...field.value, p.id]
                                      : field.value.filter((x) => x !== p.id);
                                    field.onChange(next);
                                  }}
                                />
                                <span>
                                  {p.code ? `${p.code} · ${p.name}` : p.name}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sections"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sections</FormLabel>
                      <div className="grid grid-cols-2 gap-2">
                        {SHARE_SECTIONS.map((s) => {
                          const disabled =
                            s === "financials" && role !== "lender_viewer";
                          const checked = sections.includes(s);
                          const label = (
                            <label
                              key={s}
                              className={`flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm ${
                                disabled
                                  ? "opacity-50"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={disabled}
                                onCheckedChange={(v) => {
                                  const next = v
                                    ? Array.from(new Set([...field.value, s]))
                                    : field.value.filter((x) => x !== s);
                                  field.onChange(next);
                                }}
                              />
                              <span>{SECTION_LABELS[s]}</span>
                            </label>
                          );
                          if (!disabled) return label;
                          return (
                            <TooltipProvider key={s}>
                              <Tooltip>
                                <TooltipTrigger asChild>{label}</TooltipTrigger>
                                <TooltipContent>
                                  Only visible when Audience = Lender viewer
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresPreset"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expires in</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EXPIRY_PRESETS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {EXPIRY_LABELS[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMut.isPending}>
                    Create link
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
