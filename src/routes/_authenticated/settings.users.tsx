import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, RotateCcw, Trash2 } from "lucide-react";

import {
  createInvite,
  getCompanyAdminSnapshot,
  listInvites,
  resendInvite,
  revokeInvite,
} from "@/lib/invites.functions";
import { Constants } from "@/integrations/supabase/types";
import { useActiveCompany } from "@/components/company-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/settings/users")({
  head: () => ({
    meta: [
      { title: "Users | GridMind EPC" },
      {
        name: "description",
        content:
          "Manage members and pending invitations for your GridMind EPC workspace.",
      },
      { property: "og:title", content: "Users | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Manage members and pending invitations for your GridMind EPC workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UsersPage,
});

// super_admin is only grantable by another super_admin at the DB level;
// hide it from the UI dropdown per spec.
const ROLE_OPTIONS = Constants.public.Enums.app_role.filter(
  (r) => r !== "super_admin",
);

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

function UsersPage() {
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listInvites);
  const snapshotFn = useServerFn(getCompanyAdminSnapshot);
  const createFn = useServerFn(createInvite);
  const revokeFn = useServerFn(revokeInvite);
  const resendFn = useServerFn(resendInvite);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["company-admin-snapshot", activeCompanyId],
    queryFn: () => snapshotFn({ data: { companyId: activeCompanyId } }),
  });

  const invitesQuery = useQuery({
    queryKey: ["invites", activeCompanyId],
    queryFn: () => listFn({ data: { companyId: activeCompanyId } }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invites", activeCompanyId] });
    queryClient.invalidateQueries({
      queryKey: ["company-admin-snapshot", activeCompanyId],
    });
  };

  const createMut = useMutation({
    mutationFn: (vars: FormValues) =>
      createFn({
        data: {
          companyId: activeCompanyId,
          email: vars.email,
          role: vars.role,
        },
      }),
    onSuccess: (result) => {
      setIssuedLink(result.acceptUrl);
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not create invite");
    },
  });

  const revokeMut = useMutation({
    mutationFn: (inviteId: string) => revokeFn({ data: { inviteId } }),
    onSuccess: () => {
      toast.success("Invite revoked");
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not revoke invite");
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
      toast.error(err instanceof Error ? err.message : "Could not resend invite");
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", role: "engineer" },
  });

  const isAdmin = snapshotQuery.data?.isAdmin ?? false;
  const adminCount = snapshotQuery.data?.adminCount ?? 0;
  const members = snapshotQuery.data?.members ?? [];
  const invites = invitesQuery.data ?? [];

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) =>
        (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? ""),
      ),
    [members],
  );

  const onSubmit = (values: FormValues) => createMut.mutate(values);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy — copy it manually");
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setIssuedLink(null);
    createMut.reset();
    form.reset();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Users
          </h1>
          <p className="text-sm text-muted-foreground">
            Workspace members and pending invitations.
          </p>
        </div>
        {isAdmin && (
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
                      Share this link with the recipient. It will only be shown
                      once.
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
                    <form
                      onSubmit={form.handleSubmit(onSubmit)}
                      className="space-y-4"
                    >
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
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a role" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {ROLE_OPTIONS.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role.replace(/_/g, " ")}
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
        )}
      </div>

      {snapshotQuery.data && adminCount === 1 && (
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Members
        </h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshotQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Loading members…
                  </TableCell>
                </TableRow>
              )}
              {snapshotQuery.isError && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-destructive">
                    {snapshotQuery.error instanceof Error
                      ? snapshotQuery.error.message
                      : "Failed to load members"}
                  </TableCell>
                </TableRow>
              )}
              {snapshotQuery.data && sortedMembers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              )}
              {sortedMembers.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">
                    {m.fullName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r) => (
                        <Badge key={r} variant="outline">
                          {r.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Invitations
        </h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitesQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading invites…
                  </TableCell>
                </TableRow>
              )}
              {invitesQuery.isError && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-destructive">
                    {invitesQuery.error instanceof Error
                      ? invitesQuery.error.message
                      : "Failed to load invites"}
                  </TableCell>
                </TableRow>
              )}
              {invitesQuery.data && invites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No invites sent yet.
                    {isAdmin && (
                      <> Click <span className="text-foreground">Invite member</span> to get started.</>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {invites.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.role.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
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
                        disabled={
                          !isAdmin ||
                          row.status !== "pending" ||
                          resendMut.isPending
                        }
                        onClick={() => resendMut.mutate(row.id)}
                        aria-label="Resend"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={
                          !isAdmin ||
                          row.status !== "pending" ||
                          revokeMut.isPending
                        }
                        onClick={() => revokeMut.mutate(row.id)}
                        aria-label="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
