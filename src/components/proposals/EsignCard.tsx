// P-049 — E-signature card for the proposal builder.
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Download,
  Eye,
  FileSignature,
  Loader2,
  RefreshCw,
  Send,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildProposalPdf,
  type ProposalPdfData,
} from "@/lib/exports/proposal-pdf";
import {
  getEsignConfigStatus,
  getProposalExportData,
  getSignedCopyDownloadUrl,
  refreshProposalEsign,
  sendProposalForSignature,
  simulateEsignEvent,
  voidProposalEsign,
} from "@/lib/proposal.functions";

type EsignStatus = "sent" | "viewed" | "completed" | "declined" | "voided";

interface EsignHistoryEntry {
  at: string;
  event: EsignStatus;
  actor: string | null;
  note?: string | null;
}

interface EsignCardProps {
  proposal: {
    id: string;
    status: string;
    version: number;
    esign_status?: string | null;
    esign_provider?: string | null;
    esign_envelope_id?: string | null;
    esign_sent_at?: string | null;
    esign_completed_at?: string | null;
    esign_history?: EsignHistoryEntry[] | null;
    signed_copy_path?: string | null;
  };
  canWrite: boolean;
  isCompanyAdmin: boolean;
}

const sendSchema = z.object({
  signerName: z.string().trim().min(1, "Required").max(200),
  signerEmail: z.string().trim().email("Invalid email").max(320),
});

function statusVariant(
  s: string | null | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  switch (s) {
    case "completed":
      return "default";
    case "sent":
    case "viewed":
      return "secondary";
    case "declined":
    case "voided":
      return "destructive";
    default:
      return "outline";
  }
}

function eventIcon(e: EsignStatus) {
  const p = "h-3.5 w-3.5";
  switch (e) {
    case "sent":
      return <Send className={p} aria-hidden />;
    case "viewed":
      return <Eye className={p} aria-hidden />;
    case "completed":
      return <CheckCircle2 className={p} aria-hidden />;
    case "declined":
      return <XCircle className={p} aria-hidden />;
    case "voided":
      return <ShieldOff className={p} aria-hidden />;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHUNK) as unknown as number[]),
    );
  }
  return btoa(binary);
}

export function EsignCard({ proposal, canWrite, isCompanyAdmin }: EsignCardProps) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["proposal", proposal.id] });

  const cfgFn = useServerFn(getEsignConfigStatus);
  const cfgQ = useQuery({
    queryKey: ["esign-config"],
    queryFn: () => cfgFn(),
    staleTime: 5 * 60 * 1000,
  });

  const getData = useServerFn(getProposalExportData);
  const sendFn = useServerFn(sendProposalForSignature);
  const refreshFn = useServerFn(refreshProposalEsign);
  const voidFn = useServerFn(voidProposalEsign);
  const simulateFn = useServerFn(simulateEsignEvent);
  const signedUrlFn = useServerFn(getSignedCopyDownloadUrl);

  const [sending, setSending] = useState(false);
  const form = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: { signerName: "", signerEmail: "" },
  });

  const cfg = cfgQ.data;
  const configured = !!cfg?.configured;
  const isDevMode = !!cfg?.devMode;

  const cfoApproved = proposal.status === "approved";
  const alreadyOut =
    proposal.esign_status === "sent" || proposal.esign_status === "viewed";
  const completed = proposal.esign_status === "completed";
  const sendDisabled =
    !configured ||
    !canWrite ||
    !cfoApproved ||
    alreadyOut ||
    completed ||
    sending;

  const sendTooltip = !configured
    ? "E-signature provider not configured"
    : !canWrite
      ? "Requires sales or company_admin role"
      : !cfoApproved
        ? "Requires CFO approval (see Pricing & approval)"
        : alreadyOut
          ? "Envelope already out for signature"
          : completed
            ? "Proposal already signed"
            : "Send to signer";

  async function onSend(values: z.infer<typeof sendSchema>) {
    if (sending) return;
    setSending(true);
    try {
      const data = (await getData({
        data: { proposalId: proposal.id },
      })) as ProposalPdfData;
      const { blob } = await buildProposalPdf(data);
      const pdfBase64 = await blobToBase64(blob);
      await sendFn({
        data: {
          proposalId: proposal.id,
          signerName: values.signerName,
          signerEmail: values.signerEmail,
          pdfBase64,
        },
      });
      toast.success("Sent for signature");
      form.reset();
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  }

  const refreshM = useMutation({
    mutationFn: () => refreshFn({ data: { proposalId: proposal.id } }),
    onSuccess: () => {
      toast.success("Status refreshed");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Refresh failed"),
  });

  const voidM = useMutation({
    mutationFn: (reason: string | undefined) =>
      voidFn({ data: { proposalId: proposal.id, reason } }),
    onSuccess: () => {
      toast.success("Envelope voided");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Void failed"),
  });

  const simulateM = useMutation({
    mutationFn: (event: EsignStatus) =>
      simulateFn({ data: { proposalId: proposal.id, event } }),
    onSuccess: (_r, ev) => {
      toast.success(`Simulated ${ev}`);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Simulate failed"),
  });

  const downloadM = useMutation({
    mutationFn: () => signedUrlFn({ data: { proposalId: proposal.id } }),
    onSuccess: (r: any) => {
      if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Download failed"),
  });

  const history = useMemo<EsignHistoryEntry[]>(
    () =>
      Array.isArray(proposal.esign_history)
        ? (proposal.esign_history as EsignHistoryEntry[])
        : [],
    [proposal.esign_history],
  );

  if (cfgQ.isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading e-signature…
        </div>
      </Card>
    );
  }

  if (!configured) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">E-signature</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          E-signature provider not configured. Set{" "}
          <code className="rounded bg-muted px-1">ESIGN_PROVIDER</code> in the
          backend secret store to enable this section.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">E-signature</h3>
          {proposal.esign_status && (
            <Badge variant={statusVariant(proposal.esign_status)}>
              {proposal.esign_status}
            </Badge>
          )}
          {isDevMode && (
            <Badge variant="outline" className="border-warning/50 text-warning">
              dev mode
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {proposal.esign_envelope_id && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refreshM.mutate()}
              disabled={refreshM.isPending}
              title="Poll provider for latest status"
            >
              {refreshM.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Refresh status
            </Button>
          )}
          {isDevMode &&
            canWrite &&
            proposal.esign_envelope_id &&
            !completed &&
            proposal.esign_status !== "voided" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={simulateM.isPending}
                  >
                    {simulateM.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Simulate…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => simulateM.mutate("viewed")}>
                    Viewed
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => simulateM.mutate("completed")}>
                    Completed (upload signed PDF)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => simulateM.mutate("declined")}>
                    Declined
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          {isCompanyAdmin &&
            proposal.esign_envelope_id &&
            !completed &&
            proposal.esign_status !== "voided" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => voidM.mutate(undefined)}
                disabled={voidM.isPending}
              >
                {voidM.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                )}
                Void
              </Button>
            )}
          {proposal.signed_copy_path && (
            <Button
              size="sm"
              variant="default"
              onClick={() => downloadM.mutate()}
              disabled={downloadM.isPending}
            >
              {downloadM.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              Download signed copy
            </Button>
          )}
        </div>
      </div>

      {!proposal.esign_envelope_id && (
        <form
          onSubmit={form.handleSubmit(onSend)}
          className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="signerName" className="text-xs text-muted-foreground">
              Signer name
            </label>
            <Input
              id="signerName"
              disabled={sendDisabled}
              {...form.register("signerName")}
            />
            {form.formState.errors.signerName && (
              <span className="text-xs text-destructive">
                {form.formState.errors.signerName.message}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="signerEmail" className="text-xs text-muted-foreground">
              Signer email
            </label>
            <Input
              id="signerEmail"
              type="email"
              disabled={sendDisabled}
              {...form.register("signerEmail")}
            />
            {form.formState.errors.signerEmail && (
              <span className="text-xs text-destructive">
                {form.formState.errors.signerEmail.message}
              </span>
            )}
          </div>
          <Button type="submit" disabled={sendDisabled} title={sendTooltip}>
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            {sending ? "Sending…" : "Send for signature"}
          </Button>
          {!cfoApproved && (
            <p className="col-span-full text-xs text-muted-foreground">
              Send is blocked until CFO approval is complete (Pricing & approval
              section).
            </p>
          )}
        </form>
      )}

      {history.length > 0 && (
        <ol className="flex flex-col gap-2 border-l border-border/60 pl-4">
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="relative">
              <span className="absolute -left-[19px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background text-primary ring-1 ring-border">
                {eventIcon(h.event)}
              </span>
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-medium capitalize text-foreground">
                  {h.event}
                </span>
                <span className="text-muted-foreground">
                  {(() => {
                    try {
                      return formatDistanceToNow(new Date(h.at), {
                        addSuffix: true,
                      });
                    } catch {
                      return h.at;
                    }
                  })()}
                </span>
                {h.note && (
                  <span className="text-muted-foreground">— {h.note}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {proposal.esign_envelope_id && (
        <p className="text-[11px] text-muted-foreground">
          Envelope{" "}
          <code className="rounded bg-muted px-1">
            {proposal.esign_envelope_id}
          </code>
          {proposal.esign_provider ? ` · ${proposal.esign_provider}` : ""}
        </p>
      )}
    </Card>
  );
}
