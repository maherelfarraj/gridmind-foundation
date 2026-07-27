// P-222 — Internal "Portal access" tab: vendor portal memberships, invites, exposure.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mail, ShieldOff, Undo2, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  DEFAULT_VENDOR_EXPOSURE,
  VENDOR_EXPOSURE_KEYS,
  VENDOR_EXPOSURE_LABELS,
  inviteExpiryDate,
  type VendorExposure,
} from "@/lib/vendor-portal.rules";
import {
  inviteVendorContact,
  listVendorPortalEvents,
  listVendorPortalMembers,
  reactivateVendorPortalMember,
  revokeVendorPortalMember,
  suspendVendorPortalMember,
  updateVendorPortalExposure,
} from "@/lib/vendor-portal.functions";

function statusVariant(status: string) {
  if (status === "active") return "default" as const;
  if (status === "invited") return "secondary" as const;
  return "outline" as const;
}

export function VendorPortalAccess({
  vendorId,
  canWrite,
}: {
  vendorId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const membersFn = useServerFn(listVendorPortalMembers);
  const eventsFn = useServerFn(listVendorPortalEvents);
  const suspendFn = useServerFn(suspendVendorPortalMember);
  const revokeFn = useServerFn(revokeVendorPortalMember);
  const reactivateFn = useServerFn(reactivateVendorPortalMember);
  const exposureFn = useServerFn(updateVendorPortalExposure);

  const members = useQuery({
    queryKey: ["vendor-portal", "members", vendorId],
    queryFn: () => membersFn({ data: { vendorId } }),
  });
  const events = useQuery({
    queryKey: ["vendor-portal", "events", vendorId],
    queryFn: () => eventsFn({ data: { vendorId } }),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["vendor-portal", "members", vendorId] });
    void qc.invalidateQueries({ queryKey: ["vendor-portal", "events", vendorId] });
  };

  const statusMutation = useMutation({
    mutationFn: async (args: { id: string; action: "suspend" | "revoke" | "reactivate" }) => {
      if (args.action === "suspend") return suspendFn({ data: { id: args.id } });
      if (args.action === "revoke") return revokeFn({ data: { id: args.id } });
      return reactivateFn({ data: { id: args.id } });
    },
    onSuccess: () => {
      toast.success("Membership updated");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update membership"),
  });

  const exposureMutation = useMutation({
    mutationFn: (args: { id: string; exposure: VendorExposure }) => exposureFn({ data: args }),
    onSuccess: () => {
      toast.success("Exposure updated");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update exposure"),
  });

  const [confirm, setConfirm] = useState<{ id: string; action: "suspend" | "revoke" } | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Portal access</CardTitle>
          {canWrite ? <InviteDialog vendorId={vendorId} onDone={invalidate} /> : null}
        </CardHeader>
        <CardContent>
          {members.isLoading ? (
            <div className="h-24 animate-pulse rounded-md bg-muted" />
          ) : members.error ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">Couldn’t load portal memberships.</p>
              <Button variant="outline" size="sm" onClick={() => void members.refetch()}>
                Try again
              </Button>
            </div>
          ) : (members.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No portal contacts yet. Invite a vendor contact to give them access.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.email}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(m.status)} className="capitalize">
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {VENDOR_EXPOSURE_KEYS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            disabled={!canWrite || exposureMutation.isPending}
                            onClick={() =>
                              exposureMutation.mutate({
                                id: m.id,
                                exposure: { ...m.exposure, [k]: !m.exposure[k] },
                              })
                            }
                            className="disabled:cursor-default"
                          >
                            <Badge
                              variant={m.exposure[k] ? "secondary" : "outline"}
                              className={m.exposure[k] ? "" : "text-muted-foreground"}
                            >
                              {VENDOR_EXPOSURE_LABELS[k]}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.last_seen_at ? formatDateTime(m.last_seen_at) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.expires_at ? formatDate(m.expires_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite ? (
                        <div className="flex justify-end gap-1">
                          {m.status === "active" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirm({ id: m.id, action: "suspend" })}
                            >
                              <ShieldOff className="mr-1 h-3.5 w-3.5" /> Suspend
                            </Button>
                          ) : m.status === "suspended" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                statusMutation.mutate({ id: m.id, action: "reactivate" })
                              }
                            >
                              <Undo2 className="mr-1 h-3.5 w-3.5" /> Reactivate
                            </Button>
                          ) : null}
                          {m.status !== "revoked" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirm({ id: m.id, action: "revoke" })}
                            >
                              <UserX className="mr-1 h-3.5 w-3.5" /> Revoke
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent portal activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isLoading ? (
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No portal activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(e.created_at)}
                  </span>
                  <span className="text-foreground">{e.event.replace("vendor_portal.", "")}</span>
                  <Badge variant="outline" className="ml-auto capitalize">
                    {e.actor_type}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "revoke" ? "Revoke portal access?" : "Suspend portal access?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Access is blocked immediately. Revoking cannot be undone from this screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) statusMutation.mutate(confirm);
                setConfirm(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InviteDialog({ vendorId, onDone }: { vendorId: string; onDone: () => void }) {
  const inviteFn = useServerFn(inviteVendorContact);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [exposure, setExposure] = useState<VendorExposure>({ ...DEFAULT_VENDOR_EXPOSURE });

  const mutation = useMutation({
    mutationFn: () => inviteFn({ data: { vendorId, email, exposure, expiresInDays: 7 } }),
    onSuccess: () => {
      toast.success("Invitation sent");
      setOpen(false);
      setEmail("");
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not invite contact"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Mail className="mr-2 h-4 w-4" /> Invite vendor contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite vendor contact</DialogTitle>
          <DialogDescription>
            Invite expires {formatDate(inviteExpiryDate(7).toISOString())}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vendor-invite-email">Email</Label>
            <Input
              id="vendor-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@vendor.com"
            />
          </div>
          <div className="space-y-2">
            <Label>What they can see</Label>
            {VENDOR_EXPOSURE_KEYS.map((k) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{VENDOR_EXPOSURE_LABELS[k]}</span>
                <Switch
                  checked={exposure[k]}
                  onCheckedChange={(v) => setExposure((prev) => ({ ...prev, [k]: v }))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !email.includes("@")}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
