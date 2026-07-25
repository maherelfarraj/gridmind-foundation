// P-098 — Turnover pack workspace
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { supabase } from "@/integrations/supabase/client";
import { buildTurnoverIndexPdfBytes } from "@/lib/exports/turnover-index-pdf";
import {
  addTurnoverItems,
  attachTurnoverIndex,
  compileTurnoverPackage,
  getTurnoverPack,
  markTurnoverDelivered,
  type TurnoverBoard,
  type TurnoverPackRow,
} from "@/lib/turnover.functions";
import type { TurnoverSectionKey } from "@/lib/turnover.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/commissioning/turnover",
)({
  head: () => ({
    meta: [
      { title: "Turnover pack | GridMind EPC" },
      {
        name: "description",
        content:
          "Compile the project turnover pack — as-built drawings, warranties, O&M manual, test reports and certificates — and deliver a branded index PDF.",
      },
      { property: "og:title", content: "Turnover pack | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Compile and deliver the project turnover / as-built pack with a branded index PDF.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error, reset }) => (
    <ErrorState message={error.message} onRetry={reset} />
  ),
  notFoundComponent: () => (
    <ErrorState message="Turnover pack not found." onRetry={() => void 0} />
  ),
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["turnover", params.projectId],
      queryFn: () => getTurnoverPack({ data: { projectId: params.projectId } }),
    }),
  component: TurnoverRoute,
});

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p className="text-sm text-destructive">Unable to load turnover pack.</p>
          <p className="text-xs text-muted-foreground">{message}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function urlToPngDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function TurnoverRoute() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const compileFn = useServerFn(compileTurnoverPackage);
  const attachFn = useServerFn(attachTurnoverIndex);
  const addFn = useServerFn(addTurnoverItems);
  const deliverFn = useServerFn(markTurnoverDelivered);

  const { data: board } = useSuspenseQuery({
    queryKey: ["turnover", projectId],
    queryFn: () => getTurnoverPack({ data: { projectId } }),
  }) as { data: TurnoverBoard };

  const [compiling, setCompiling] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState("");
  const [uploadingKey, setUploadingKey] = useState<TurnoverSectionKey | null>(
    null,
  );
  const fileInputRefs = useRef<
    Record<string, HTMLInputElement | null>
  >({});

  const isClientOnly =
    !board.permissions.canReadFull &&
    board.roles.includes("client_viewer");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["turnover", projectId] });

  async function handleCompile() {
    try {
      setCompiling(true);
      const res = await compileFn({ data: { projectId } });
      if (res.missing.length > 0) {
        toast.warning("Pack still compiling", {
          description: `Missing: ${res.missing.join(", ")}`,
        });
      }
      if (res.pack.status === "ready" && res.indexPdfTargetPath) {
        // Render branded PDF client-side and upload.
        const logoDataUrl = board.branding.logoSignedUrl
          ? await urlToPngDataUrl(board.branding.logoSignedUrl)
          : null;
        const bytes = buildTurnoverIndexPdfBytes({
          company: {
            name: board.company.name,
            legalName: board.company.legal_name,
          },
          project: board.project,
          branding: {
            primaryColor: board.branding.primaryColor,
            accentColor: board.branding.accentColor,
            logoDataUrl,
          },
          sections: res.pack.sections.map((s) => ({
            key: s.key,
            label: s.label,
            required: s.required,
            items: s.items.map((i) => ({
              label: i.label,
              source: i.source,
              revision: i.revision,
              document_date: i.document_date,
            })),
          })),
          compiledAt: res.pack.compiled_at ?? new Date().toISOString(),
        });
        const up = await supabase.storage
          .from("closeout")
          .upload(res.indexPdfTargetPath, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (up.error) throw up.error;
        await attachFn({
          data: {
            projectId,
            indexPdfPath: res.indexPdfTargetPath,
          } as any,
        });
        toast.success("Pack compiled", {
          description: "Branded index PDF generated.",
        });
      } else {
        toast.info("Pack saved as compiling.");
      }
      await invalidate();
    } catch (e: any) {
      toast.error("Compile failed", { description: e?.message ?? "Error" });
    } finally {
      setCompiling(false);
    }
  }

  async function handleUpload(
    sectionKey: "om_manual" | "warranties",
    files: FileList | null,
  ) {
    if (!files || files.length === 0) return;
    try {
      setUploadingKey(sectionKey);
      const uploadedItems: {
        label: string;
        file_path: string;
        source: string;
        revision: null;
        document_date: string | null;
      }[] = [];
      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${board.companyId}/turnover/${projectId}/${sectionKey}/${Date.now()}-${safeName}`;
        const up = await supabase.storage
          .from("closeout")
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
        if (up.error) throw up.error;
        uploadedItems.push({
          label: file.name,
          file_path: path,
          source: "manual",
          revision: null,
          document_date: new Date().toISOString().slice(0, 10),
        });
      }
      await addFn({
        data: {
          projectId,
          sectionKey,
          items: uploadedItems,
        },
      });
      toast.success(`${uploadedItems.length} file(s) added`);
      await invalidate();
    } catch (e: any) {
      toast.error("Upload failed", { description: e?.message ?? "Error" });
    } finally {
      setUploadingKey(null);
    }
  }

  async function handleDeliver() {
    try {
      await deliverFn({
        data: {
          projectId,
          acceptedBy: acceptedBy.trim() ? acceptedBy.trim() : null,
        },
      });
      toast.success("Pack marked as delivered");
      setDeliverOpen(false);
      setAcceptedBy("");
      await invalidate();
    } catch (e: any) {
      toast.error("Deliver failed", { description: e?.message ?? "Error" });
    }
  }

  async function openIndexPdf() {
    if (!board.pack?.index_pdf_path) return;
    const { data, error } = await supabase.storage
      .from("closeout")
      .createSignedUrl(board.pack.index_pdf_path, 60 * 10);
    if (error || !data?.signedUrl) {
      toast.error("Could not open index PDF");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  // ---------------------------------------------------------------------
  // Render — client_viewer branch (delivered-only index PDF)
  // ---------------------------------------------------------------------
  if (isClientOnly) {
    const delivered =
      board.pack &&
      (board.pack.status === "delivered" || board.pack.status === "accepted");
    return (
      <div className="p-6">
        <Header board={board} projectId={projectId} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package size={16} aria-hidden />
              Turnover pack
            </CardTitle>
          </CardHeader>
          <CardContent>
            {delivered && board.pack?.index_pdf_path ? (
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={openIndexPdf}>
                  <Download size={14} aria-hidden />
                  Download index PDF
                </Button>
                <span className="text-xs text-muted-foreground">
                  Delivered{" "}
                  {board.pack.delivered_at
                    ? new Date(board.pack.delivered_at).toLocaleDateString()
                    : ""}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Turnover pack not delivered yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Full workspace
  // ---------------------------------------------------------------------
  const pack = board.pack;
  const sections = pack?.sections ?? [];
  const statusLabel = pack?.status ?? "not compiled";

  return (
    <div className="space-y-4 p-6">
      <Header board={board} projectId={projectId} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package size={16} aria-hidden />
              Turnover pack
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Status:{" "}
              <Badge
                variant={
                  statusLabel === "delivered" || statusLabel === "accepted"
                    ? "default"
                    : statusLabel === "ready"
                      ? "secondary"
                      : "outline"
                }
                className="ml-1"
              >
                {statusLabel}
              </Badge>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {board.permissions.canWrite ? (
              <Button size="sm" onClick={handleCompile} disabled={compiling}>
                {compiling ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCw size={14} aria-hidden />
                )}
                {pack ? "Recompile" : "Compile pack"}
              </Button>
            ) : null}
            {pack?.index_pdf_path ? (
              <Button size="sm" variant="outline" onClick={openIndexPdf}>
                <Download size={14} aria-hidden />
                Index PDF
              </Button>
            ) : null}
            {board.permissions.canWrite &&
            pack &&
            (pack.status === "ready" || pack.status === "delivered") ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDeliverOpen(true)}
              >
                <CheckCircle2 size={14} aria-hidden />
                Mark delivered
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {!pack ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-10">
            <p className="text-sm text-muted-foreground">
              Turnover pack not compiled yet.
            </p>
            {board.permissions.canWrite ? (
              <Button size="sm" onClick={handleCompile} disabled={compiling}>
                <RefreshCw size={14} aria-hidden />
                Compile now
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map((s) => {
            const uploadable = s.key === "om_manual" || s.key === "warranties";
            const isBusy = uploadingKey === s.key;
            return (
              <Card key={s.key}>
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {s.complete ? (
                        <CheckCircle2
                          size={16}
                          aria-hidden
                          className="text-emerald-500"
                        />
                      ) : (
                        <Circle
                          size={16}
                          aria-hidden
                          className="text-muted-foreground"
                        />
                      )}
                      {s.label}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.items.length} document(s)
                      {s.required ? " • required" : ""}
                    </p>
                  </div>
                  {uploadable && board.permissions.canWrite ? (
                    <div>
                      <input
                        ref={(el) => {
                          fileInputRefs.current[s.key] = el;
                        }}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) =>
                          handleUpload(
                            s.key as "om_manual" | "warranties",
                            e.target.files,
                          )
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => fileInputRefs.current[s.key]?.click()}
                      >
                        {isBusy ? (
                          <Loader2
                            size={14}
                            className="animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Upload size={14} aria-hidden />
                        )}
                        Upload
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {s.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No documents in this section yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {s.items.slice(0, 6).map((i, idx) => (
                        <li
                          key={`${i.file_path}-${idx}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="flex items-center gap-1 truncate">
                            <FileText size={12} aria-hidden />
                            <span className="truncate" title={i.label}>
                              {i.label}
                            </span>
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {i.revision ? `rev ${i.revision} • ` : ""}
                            {i.document_date ?? ""}
                          </span>
                        </li>
                      ))}
                      {s.items.length > 6 ? (
                        <li className="text-xs text-muted-foreground">
                          + {s.items.length - 6} more…
                        </li>
                      ) : null}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark pack as delivered</DialogTitle>
            <DialogDescription>
              Delivery timestamps the handover. Fill acceptance name only when
              the client has formally accepted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="accepted-by">Accepted by (optional)</Label>
            <Input
              id="accepted-by"
              value={acceptedBy}
              onChange={(e) => setAcceptedBy(e.target.value)}
              placeholder="Client representative name"
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeliver}>Confirm delivery</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({
  board,
  projectId,
}: {
  board: TurnoverBoard;
  projectId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link
            to="/projects/$projectId/commissioning"
            params={{ projectId }}
          >
            <ArrowLeft size={14} aria-hidden />
            Back to commissioning
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Turnover pack</h1>
        <p className="text-sm text-muted-foreground">
          {board.project.name}
          {board.project.code ? ` (${board.project.code})` : ""}
        </p>
      </div>
    </div>
  );
}
