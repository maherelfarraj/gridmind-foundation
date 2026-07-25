// P-108 — Warranty detail drawer with Details / Document / Claims tabs.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileUp, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WarrantyDialog } from "@/components/warranties/warranty-dialog";
import { ClaimDialog } from "@/components/warranties/claim-dialog";
import {
  advanceClaimStatus,
  deleteWarranty,
  isCurrentUserOmAdmin,
  listClaims,
  saveWarrantyDocumentPath,
  settleClaim,
  signWarrantyDocumentDownloadUrl,
  signWarrantyDocumentUploadUrl,
  submitClaim,
  type ClaimRow,
  type WarrantyRow,
} from "@/lib/warranties.functions";
import {
  daysRemaining,
  warrantyStatusBadge,
  type WarrantyClaimStatus,
} from "@/lib/warranties.rules";

interface Props {
  warranty: WarrantyRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

function StatusBadge({ status }: { status: WarrantyClaimStatus }) {
  const variant: Record<WarrantyClaimStatus, "default" | "secondary" | "outline" | "destructive"> = {
    draft: "outline",
    submitted: "secondary",
    under_review: "secondary",
    approved: "default",
    rejected: "destructive",
    settled: "default",
  };
  return <Badge variant={variant[status]}>{status.replace("_", " ")}</Badge>;
}

export function WarrantyDrawer({ warranty, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("details");
  const fileRef = useRef<HTMLInputElement>(null);
  const signUploadFn = useServerFn(signWarrantyDocumentUploadUrl);
  const savePathFn = useServerFn(saveWarrantyDocumentPath);
  const signDownloadFn = useServerFn(signWarrantyDocumentDownloadUrl);
  const listClaimsFn = useServerFn(listClaims);
  const submitFn = useServerFn(submitClaim);
  const advanceFn = useServerFn(advanceClaimStatus);
  const settleFn = useServerFn(settleClaim);
  const deleteFn = useServerFn(deleteWarranty);
  const omAdminFn = useServerFn(isCurrentUserOmAdmin);

  const omAdminQ = useQuery({
    queryKey: ["is-om-admin"],
    queryFn: () => omAdminFn(),
    enabled: open,
  });
  const claimsQ = useQuery({
    queryKey: ["claims", warranty?.id],
    queryFn: () => listClaimsFn({ data: { warranty_id: warranty!.id } }),
    enabled: !!warranty?.id && open,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!warranty) throw new Error("no_warranty");
      const { path, token } = await signUploadFn({
        data: { warranty_id: warranty.id, filename: file.name },
      });
      const { error } = await supabase.storage
        .from("documents")
        .uploadToSignedUrl(path, token, file);
      if (error) throw error;
      await savePathFn({ data: { warranty_id: warranty.id, path } });
      return path;
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      qc.invalidateQueries({ queryKey: ["warranties"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Upload failed"),
  });

  const download = useMutation({
    mutationFn: async (path: string) => {
      const { url } = await signDownloadFn({ data: { path } });
      if (!url) throw new Error("failed_to_sign");
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) => toast.error(e.message ?? "Download failed"),
  });

  const claimMut = useMutation({
    mutationFn: async (args: { kind: "submit" | "advance" | "settle"; payload: unknown }) => {
      if (args.kind === "submit") return submitFn({ data: args.payload as { id: string } });
      if (args.kind === "advance")
        return advanceFn({ data: args.payload as never });
      return settleFn({ data: args.payload as never });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims", warranty?.id] });
      qc.invalidateQueries({ queryKey: ["warranty-kpis"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Action failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Warranty deleted");
      qc.invalidateQueries({ queryKey: ["warranties"] });
      qc.invalidateQueries({ queryKey: ["warranty-kpis"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Delete failed"),
  });

  if (!warranty) return null;
  const days = daysRemaining(warranty.end_date);
  const badge = warrantyStatusBadge(days);
  const isOmAdmin = omAdminQ.data?.isOmAdmin ?? false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{warranty.equipment_tag ?? warranty.project_name ?? "Warranty"}</span>
            <Badge variant="outline">{warranty.warranty_type.replace("_", " ")}</Badge>
            <Badge
              className={
                badge === "active"
                  ? "bg-success text-success-foreground"
                  : badge === "expiring"
                    ? "bg-warning text-warning-foreground"
                    : "bg-muted text-muted-foreground"
              }
            >
              {badge === "expired"
                ? `Expired ${Math.abs(days)}d ago`
                : `${days}d remaining`}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            {warranty.project_name}
            {warranty.vendor_name ? ` · ${warranty.vendor_name}` : ""}
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="document">Document</TabsTrigger>
            <TabsTrigger value="claims">
              Claims{" "}
              <span className="ml-1 text-xs text-muted-foreground">
                {(claimsQ.data as ClaimRow[] | undefined)?.length ?? 0}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Start date</div>
                <div>{warranty.start_date}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">End date</div>
                <div>{warranty.end_date}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Terms</div>
                <div className="whitespace-pre-wrap">
                  {warranty.terms || <span className="text-muted-foreground">—</span>}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Coverage notes</div>
                <div className="whitespace-pre-wrap">
                  {warranty.coverage_notes || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <WarrantyDialog
                warranty={warranty}
                trigger={
                  <Button size="sm" variant="outline">
                    <Pencil className="mr-1 h-4 w-4" /> Edit
                  </Button>
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Delete this warranty?")) del.mutate(warranty.id);
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="document" className="space-y-3 pt-4">
            {warranty.document_path ? (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div className="text-sm">
                  <div className="font-medium">Warranty document</div>
                  <div className="text-xs text-muted-foreground">
                    {warranty.document_path.split("/").pop()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => download.mutate(warranty.document_path!)}
                >
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No document uploaded.
              </div>
            )}
            <div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <Button
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
              >
                <FileUp className="mr-1 h-4 w-4" />
                {upload.isPending ? "Uploading…" : warranty.document_path ? "Replace" : "Upload"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="claims" className="space-y-3 pt-4">
            <div className="flex justify-end">
              <ClaimDialog
                warrantyId={warranty.id}
                endDate={warranty.end_date}
                isOmAdmin={isOmAdmin}
              />
            </div>
            {claimsQ.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (claimsQ.data ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No claims yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(claimsQ.data as ClaimRow[]).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-mono text-xs">{c.claim_number}</div>
                        <div className="text-sm">{c.title}</div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.settled_amount != null
                          ? `${c.settled_amount} ${c.currency_code ?? ""} settled`
                          : c.claimed_amount != null
                            ? `${c.claimed_amount} ${c.currency_code ?? ""} claimed`
                            : "—"}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {c.status === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              claimMut.mutate({ kind: "submit", payload: { id: c.id } })
                            }
                          >
                            Submit
                          </Button>
                        )}
                        {c.status === "submitted" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              claimMut.mutate({
                                kind: "advance",
                                payload: { id: c.id, status: "under_review" },
                              })
                            }
                          >
                            Mark under review
                          </Button>
                        )}
                        {c.status === "under_review" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                claimMut.mutate({
                                  kind: "advance",
                                  payload: { id: c.id, status: "approved" },
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                claimMut.mutate({
                                  kind: "advance",
                                  payload: { id: c.id, status: "rejected" },
                                })
                              }
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {c.status === "approved" && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const raw = prompt("Settled amount:");
                              if (!raw) return;
                              const amount = Number(raw);
                              if (!Number.isFinite(amount) || amount < 0) {
                                toast.error("Invalid amount");
                                return;
                              }
                              const curr = prompt(
                                "Currency (3-letter code, optional):",
                                c.currency_code ?? "",
                              );
                              claimMut.mutate({
                                kind: "settle",
                                payload: {
                                  id: c.id,
                                  settled_amount: amount,
                                  currency_code: curr && curr.length === 3 ? curr.toUpperCase() : null,
                                },
                              });
                            }}
                          >
                            Settle
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
