// P-097 — MC + COD certificate issuance and signature capture.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, FileText, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  addSignature,
  attachSignedPdf,
  issueCertificate,
  listCertificates,
  type CommissioningCertificateRow,
} from "@/lib/commissioning-certificates.functions";
import {
  CERT_PARTY_LABELS,
  CERT_PARTIES,
  CERT_TYPE_LABELS,
  missingCertParties,
  type CertParty,
  type CertificateType,
} from "@/lib/commissioning-certificates.rules";
import { buildCertificatePdfBytes, type SignatureImage } from "@/lib/exports/certificate-pdf";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/commissioning/certificates",
)({
  head: () => ({
    meta: [
      { title: "Certificates — GridMind EPC" },
      {
        name: "description",
        content:
          "Issue Mechanical Completion and Commercial Operation Date certificates with multi-party signatures.",
      },
      { property: "og:title", content: "Certificates — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Issue Mechanical Completion and Commercial Operation Date certificates with multi-party signatures.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CertificatesPage,
});

const CARD_TYPES: CertificateType[] = ["mechanical_completion", "cod"];

async function fetchImageDataUrl(path: string, bucket: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 5);
    if (error || !data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve((r.result as string) ?? null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

function CertificatesPage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const [issueDialog, setIssueDialog] = useState<CertificateType | null>(null);
  const [signDialog, setSignDialog] = useState<{
    cert: CommissioningCertificateRow;
    party: CertParty;
  } | null>(null);

  const query = useQuery({
    queryKey: ["commissioning-certificates", projectId] as const,
    queryFn: () => listCertificates({ data: { projectId } }),
  });

  const board = query.data;
  const canIssue = board?.permissions.canIssue ?? false;
  const canSign = board?.permissions.canSign ?? false;

  const byType = useMemo(() => {
    const m = new Map<CertificateType, CommissioningCertificateRow>();
    for (const r of board?.rows ?? []) m.set(r.certificate_type, r);
    return m;
  }, [board?.rows]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Certificates
          </h2>
          <p className="text-sm text-muted-foreground">
            Mechanical Completion and Commercial Operation Date, with signed evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
              <ShieldCheck size={14} aria-hidden />
              Back to tests
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} aria-hidden className={cn(query.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-destructive">Failed to load certificates.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {CARD_TYPES.map((t) => (
            <CertificateCard
              key={t}
              type={t}
              row={byType.get(t) ?? null}
              canIssue={canIssue}
              canSign={canSign}
              onIssue={() => setIssueDialog(t)}
              onSign={(party) => {
                const row = byType.get(t);
                if (row) setSignDialog({ cert: row, party });
              }}
            />
          ))}
          <Card className="flex flex-col justify-center gap-2 border-dashed p-6 text-center">
            <Badge variant="outline" className="mx-auto">
              Coming in P-099
            </Badge>
            <p className="text-sm font-medium text-foreground">Care, Custody &amp; Control</p>
            <p className="text-xs text-muted-foreground">Handover transfer certificate.</p>
          </Card>
        </div>
      )}

      <IssueDialog
        type={issueDialog}
        board={board ?? null}
        projectId={projectId}
        open={!!issueDialog}
        onOpenChange={(open) => {
          if (!open) setIssueDialog(null);
        }}
        onDone={() => {
          setIssueDialog(null);
          qc.invalidateQueries({
            queryKey: ["commissioning-certificates", projectId],
          });
        }}
      />

      <SignDialog
        state={signDialog}
        projectId={projectId}
        board={board ?? null}
        open={!!signDialog}
        onOpenChange={(open) => {
          if (!open) setSignDialog(null);
        }}
        onDone={() => {
          setSignDialog(null);
          qc.invalidateQueries({
            queryKey: ["commissioning-certificates", projectId],
          });
        }}
      />
    </div>
  );
}

function CertificateCard({
  type,
  row,
  canIssue,
  canSign,
  onIssue,
  onSign,
}: {
  type: CertificateType;
  row: CommissioningCertificateRow | null;
  canIssue: boolean;
  canSign: boolean;
  onIssue: () => void;
  onSign: (party: CertParty) => void;
}) {
  const missing = row ? missingCertParties(type, row.signatures) : [];
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {type === "cod" ? "Stage 6 — COD" : "Stage 6 — MC"}
          </p>
          <h3 className="mt-0.5 font-display text-lg font-semibold text-foreground">
            {CERT_TYPE_LABELS[type]}
          </h3>
        </div>
        {row ? (
          <Badge
            variant="outline"
            className={cn(
              row.status === "signed"
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-foreground",
            )}
          >
            {row.status === "signed" ? "Signed" : "Pending signatures"}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-muted text-muted-foreground">
            Not issued
          </Badge>
        )}
      </div>

      {!row ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <FileText size={28} aria-hidden className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No certificate issued yet.</p>
          {canIssue ? (
            <Button size="sm" onClick={onIssue}>
              Issue {type === "cod" ? "COD" : "MC"}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Number</dt>
            <dd className="font-medium text-foreground">{row.certificate_number}</dd>
            <dt className="text-muted-foreground">Effective date</dt>
            <dd className="font-medium text-foreground">{row.effective_date ?? "—"}</dd>
            {type === "cod" && row.pr_at_cod != null ? (
              <>
                <dt className="text-muted-foreground">PR at COD</dt>
                <dd className="font-medium text-foreground">{Number(row.pr_at_cod).toFixed(2)}%</dd>
              </>
            ) : null}
          </dl>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Signatures
            </p>
            <ul className="flex flex-col gap-1">
              {CERT_PARTIES.map((p) => {
                const s = row.signatures.find((x) => x.party === p);
                const required = missing.includes(p) || !!s;
                if (!required && !s) return null;
                return (
                  <li
                    key={p}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      {s ? (
                        <CheckCircle2
                          size={12}
                          aria-hidden
                          className="text-emerald-600 dark:text-emerald-400"
                        />
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full border border-border" />
                      )}
                      <span className="font-medium text-foreground">{CERT_PARTY_LABELS[p]}</span>
                    </span>
                    {s ? (
                      <span className="text-muted-foreground">{s.name}</span>
                    ) : canSign && row.status !== "signed" ? (
                      <Button size="sm" variant="outline" onClick={() => onSign(p)}>
                        Sign
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          {row.status === "signed" && row.signed_pdf_path ? (
            <SignedPdfLink path={row.signed_pdf_path} />
          ) : null}
          {row.status === "signed" && !row.signed_pdf_path ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock size={12} aria-hidden />
              PDF generating…
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function SignedPdfLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const load = async () => {
    const { data } = await supabase.storage.from("closeout").createSignedUrl(path, 60 * 5);
    if (data?.signedUrl) setUrl(data.signedUrl);
  };
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card p-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <FileText size={12} aria-hidden />
        Signed certificate
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline"
        >
          Open PDF
        </a>
      ) : (
        <Button size="sm" variant="ghost" onClick={load}>
          Get link
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue dialog
// ---------------------------------------------------------------------------
const issueSchema = z.object({
  certificateNumber: z.string().min(2).max(80),
  effectiveDate: z.string().min(4).max(20),
  scopeNotes: z.string().max(4000),
});

function IssueDialog({
  type,
  board,
  projectId,
  open,
  onOpenChange,
  onDone,
}: {
  type: CertificateType | null;
  board: Awaited<ReturnType<typeof listCertificates>> | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const suggested = type && board ? board.suggestedNumbers[type] : "";
  const form = useForm<z.infer<typeof issueSchema>>({
    resolver: zodResolver(issueSchema),
    values: {
      certificateNumber: suggested,
      effectiveDate: new Date().toISOString().slice(0, 10),
      scopeNotes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof issueSchema>) => {
      if (!type) throw new Error("No certificate type selected");
      return issueCertificate({
        data: {
          projectId,
          type,
          effectiveDate: values.effectiveDate,
          scopeNotes: values.scopeNotes,
          certificateNumber: values.certificateNumber,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`Issued ${res.row.certificate_number}`);
      form.reset();
      onDone();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to issue certificate");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue {type ? CERT_TYPE_LABELS[type] : "Certificate"}</DialogTitle>
          <DialogDescription>
            Certificate becomes active once all required parties sign.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="flex flex-col gap-3"
        >
          <div>
            <Label htmlFor="cert-number">Certificate number</Label>
            <Input id="cert-number" {...form.register("certificateNumber")} />
            {form.formState.errors.certificateNumber ? (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.certificateNumber.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="cert-date">Effective date</Label>
            <Input id="cert-date" type="date" {...form.register("effectiveDate")} />
          </div>
          <div>
            <Label htmlFor="cert-scope">Scope notes</Label>
            <Textarea
              id="cert-scope"
              rows={4}
              placeholder="Scope of work covered by this certificate…"
              {...form.register("scopeNotes")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Issue certificate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sign dialog — canvas signature pad + upload + addSignature call
// ---------------------------------------------------------------------------
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";

function SignDialog({
  state,
  projectId,
  board,
  open,
  onOpenChange,
  onDone,
}: {
  state: { cert: CommissioningCertificateRow; party: CertParty } | null;
  projectId: string;
  board: Awaited<ReturnType<typeof listCertificates>> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [hasSig, setHasSig] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!state || !board) return;
    const dataUrl = padRef.current?.getDataUrl();
    if (!dataUrl) {
      toast.error("Please provide a signature");
      return;
    }
    setBusy(true);
    try {
      const blob = await dataUrlToBlob(dataUrl);
      const path = `${board.companyId}/certificates/${projectId}/signatures/${state.cert.id}-${state.party}.png`;
      const { error: upErr } = await supabase.storage
        .from("closeout")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;

      const res = await addSignature({
        data: {
          certificateId: state.cert.id,
          party: state.party,
          name: signerName.trim(),
          title: signerTitle.trim(),
          filePath: path,
        },
      });

      if (res.closed) {
        toast.success("Certificate signed");
        if (state.cert.certificate_type === "cod") {
          await renderAndAttachCodPdf(res.row, board);
          if (res.gate?.requested) {
            toast.success("COD phase gate submitted for review");
          } else if (res.gate?.message) {
            toast.message(`Gate note: ${res.gate.message}`);
          }
        } else {
          // MC also gets a PDF for consistency.
          await renderAndAttachCodPdf(res.row, board);
        }
      } else {
        toast.success(
          `Signature recorded — awaiting ${res.missing
            .map((p) => CERT_PARTY_LABELS[p])
            .join(", ")}`,
        );
      }
      setSignerName("");
      setSignerTitle("");
      padRef.current?.clear();
      onDone();
    } catch (e: any) {
      const raw = e?.message ?? "Failed to record signature";
      if (raw.includes("open_category_a_punch")) {
        toast.error("COD blocked — category A punch items still open");
      } else if (raw.includes("no_passing_pr_test")) {
        toast.error("COD blocked — a passing performance ratio test is required");
      } else {
        toast.error(raw);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign as {state ? CERT_PARTY_LABELS[state.party] : "party"}</DialogTitle>
          <DialogDescription>
            {state
              ? `${state.cert.certificate_number} — ${CERT_TYPE_LABELS[state.cert.certificate_type]}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="signer-name">Signer name</Label>
              <Input
                id="signer-name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label htmlFor="signer-title">Title</Label>
              <Input
                id="signer-title"
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                placeholder="e.g. Project Director"
              />
            </div>
          </div>
          <div>
            <Label>Signature</Label>
            <SignaturePad ref={padRef} onChange={setHasSig} />
          </div>
        </div>

        {state?.cert.certificate_type === "cod" ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertCircle size={12} aria-hidden className="mt-0.5" />
            <span>
              COD requires zero open category A punch items and at least one passing performance
              ratio test before signing completes.
            </span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              busy || !hasSig || signerName.trim().length < 2 || signerTitle.trim().length < 1
            }
          >
            Record signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function renderAndAttachCodPdf(
  row: CommissioningCertificateRow,
  board: Awaited<ReturnType<typeof listCertificates>>,
) {
  try {
    const logoDataUrl = board.branding.logoSignedUrl
      ? await fetch(board.branding.logoSignedUrl)
          .then((r) => r.blob())
          .then(
            (b) =>
              new Promise<string | null>((resolve) => {
                const r = new FileReader();
                r.onloadend = () => resolve((r.result as string) ?? null);
                r.onerror = () => resolve(null);
                r.readAsDataURL(b);
              }),
          )
          .catch(() => null)
      : null;

    const sigImages: SignatureImage[] = await Promise.all(
      row.signatures.map(async (s) => ({
        ...s,
        imageDataUrl: await fetchImageDataUrl(s.file_path, "closeout"),
      })),
    );

    const bytes = buildCertificatePdfBytes({
      type: row.certificate_type,
      company: board.company,
      project: board.project,
      branding: {
        primaryColor: board.branding.primaryColor,
        accentColor: board.branding.accentColor,
        logoDataUrl,
      },
      certificateNumber: row.certificate_number,
      effectiveDate: row.effective_date,
      scopeNotes: (row.payload?.scope_notes as string) ?? "",
      punchSummary: (row.payload?.punch_summary as any) ?? null,
      prAtCod: row.pr_at_cod != null ? Number(row.pr_at_cod) : null,
      signatures: sigImages,
      generatedAt: new Date().toISOString(),
    });

    const path = `${board.companyId}/certificates/${row.project_id}/${row.id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("closeout")
      .upload(path, new Blob([bytes as BlobPart], { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw upErr;
    await attachSignedPdf({ data: { certificateId: row.id, filePath: path } });
  } catch (e: any) {
    toast.error(`Certificate signed but PDF upload failed: ${e?.message ?? ""}`);
  }
}
