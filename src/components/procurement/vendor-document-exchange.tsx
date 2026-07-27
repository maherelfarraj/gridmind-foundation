// P-225 — Internal vendor document exchange panel (procurement side).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileText, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";
import {
  createVendorPublishUpload,
  listVendorExchangeDocumentsInternal,
  publishVendorDocument,
  signVendorFileUrlInternal,
  type VendorExchangeDocRow,
} from "@/lib/vendor-exchange.functions";
import {
  validateUploadFile,
  VENDOR_DOC_ALLOWED_MIME,
  VENDOR_UPLOAD_ERRORS,
  type VendorUploadErrorCode,
} from "@/lib/vendor-uploads.rules";

export function VendorDocumentExchange({
  vendorId,
  canWrite,
}: {
  vendorId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listVendorExchangeDocumentsInternal);
  const uploadFn = useServerFn(createVendorPublishUpload);
  const publishFn = useServerFn(publishVendorDocument);
  const signFn = useServerFn(signVendorFileUrlInternal);

  const key = ["vendor-portal", "exchange-docs", "internal", vendorId] as const;
  const docs = useQuery({ queryKey: key, queryFn: () => listFn({ data: { vendorId } }) });

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const publish = useMutation({
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
      return publishFn({ data: { vendorId, path: target.path, title: title.trim() } });
    },
    onSuccess: () => {
      toast.success("Published to the vendor portal");
      setTitle("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        VENDOR_UPLOAD_ERRORS[code as VendorUploadErrorCode] ?? "Could not publish that document.",
      );
    },
  });

  async function download(path: string) {
    const { url } = await signFn({ data: { path } });
    if (!url) {
      toast.error("Could not open that file.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const rows = docs.data ?? [];
  const submittals = rows.filter((d) => d.category === "vendor_submittal");
  const published = rows.filter((d) => d.category === "vendor_published");

  return (
    <div className="space-y-6">
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publish to vendor</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pub-title">Title</Label>
              <Input
                id="pub-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Technical query response — TQ-014"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pub-file">File (max 25 MB)</Label>
              <Input
                id="pub-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => publish.mutate()} disabled={publish.isPending || !file}>
                {publish.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                Publish to vendor
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DocList
        title="Uploaded by the vendor"
        empty="The vendor has not shared any documents yet."
        rows={submittals}
        loading={docs.isLoading}
        onDownload={download}
      />
      <DocList
        title="Published to the vendor"
        empty="Nothing published to this vendor yet."
        rows={published}
        loading={docs.isLoading}
        onDownload={download}
      />
    </div>
  );
}

function DocList({
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
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
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
