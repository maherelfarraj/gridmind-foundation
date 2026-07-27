// P-225 — Vendor two-way document exchange.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";
import { vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import {
  createVendorDocUpload,
  listVendorExchangeDocuments,
  signVendorFileUrl,
  submitVendorDocument,
  type VendorExchangeDocRow,
} from "@/lib/vendor-exchange.functions";
import {
  validateUploadFile,
  VENDOR_DOC_ALLOWED_MIME,
  VENDOR_UPLOAD_ERRORS,
  type VendorUploadErrorCode,
} from "@/lib/vendor-uploads.rules";

export const Route = createFileRoute("/vendor/$vendorId/documents")({
  head: () => ({
    meta: [
      { title: "Documents — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Share datasheets and certificates with your buyer and read documents they publish to you.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorDocumentsPage,
});

function VendorDocumentsPage() {
  const { vendorId } = Route.useParams();
  const qc = useQueryClient();
  const listFn = useServerFn(listVendorExchangeDocuments);
  const uploadFn = useServerFn(createVendorDocUpload);
  const registerFn = useServerFn(submitVendorDocument);
  const signFn = useServerFn(signVendorFileUrl);

  const key = ["vendor-portal", "exchange-docs", vendorId] as const;
  const docs = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { vendorId } }),
    retry: false,
  });

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const bad = validateUploadFile(file, VENDOR_DOC_ALLOWED_MIME);
      if (bad) throw new Error(bad);
      if (!title.trim()) throw new Error("title_required");
      const target = await uploadFn({
        data: { vendorId, filename: file!.name, size: file!.size, mimeType: file!.type },
      });
      const { error } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file!, { contentType: file!.type });
      if (error) throw new Error(error.message);
      return registerFn({ data: { vendorId, path: target.path, title: title.trim() } });
    },
    onSuccess: () => {
      toast.success("Document shared with your buyer");
      setTitle("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        VENDOR_UPLOAD_ERRORS[code as VendorUploadErrorCode] ??
          vendorPortalErrorCode(err) ??
          "Could not share that document.",
      );
    },
  });

  async function download(path: string) {
    const { url } = await signFn({ data: { vendorId, path } });
    if (!url) {
      toast.error("Could not open that file.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (docs.isError) {
    return (
      <div className="space-y-6">
        <BackLink vendorId={vendorId} />
        <VendorStateCard
          title="Documents are not shared with your account"
          description="Ask your buyer contact to enable document exchange for this portal login."
        />
      </div>
    );
  }

  const rows = docs.data ?? [];
  const submittals = rows.filter((d) => d.category === "vendor_submittal");
  const published = rows.filter((d) => d.category === "vendor_published");

  return (
    <div className="space-y-6">
      <BackLink vendorId={vendorId} />
      <PageHeader
        title="Documents"
        description="Two-way exchange: send datasheets and certificates, and read what your buyer publishes to you."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Share a document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Inverter datasheet rev C"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-file">File (max 25 MB)</Label>
            <Input
              id="doc-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="md:col-span-2">
            <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
              {upload.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Share with buyer
            </Button>
          </div>
        </CardContent>
      </Card>

      <DocSection
        title="Shared by us"
        empty="You have not shared any documents yet."
        rows={submittals}
        loading={docs.isLoading}
        onDownload={download}
      />
      <DocSection
        title="Shared with us"
        empty="Nothing published to you yet."
        rows={published}
        loading={docs.isLoading}
        onDownload={download}
      />
    </div>
  );
}

function DocSection({
  title,
  empty,
  rows,
  loading,
  onDownload,
}: {
  title: string;
  empty: string;
  rows: VendorExchangeDocRow[];
  loading: boolean;
  onDownload: (path: string) => void | Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <VendorTableSkeleton rows={2} />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileText} title="Nothing here yet" description={empty} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.file_name ?? "file"} · {formatDateTime(doc.created_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void onDownload(doc.storage_path)}>
                  <Download className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BackLink({ vendorId }: { vendorId: string }) {
  return (
    <Link
      to="/vendor/$vendorId"
      params={{ vendorId }}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to portal
    </Link>
  );
}
