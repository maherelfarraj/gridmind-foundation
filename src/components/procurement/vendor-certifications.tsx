// P-061 — Vendor certifications uploader (browser-side upload → server jsonb attach).
import { useRef, useState } from "react";
import { Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { Certification } from "@/lib/vendors.functions";
import {
  useAttachVendorCertification,
  useRemoveVendorCertification,
} from "@/lib/vendors-query";

interface Props {
  vendorId: string;
  companyId: string;
  certifications: Certification[];
  canWrite: boolean;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function VendorCertifications({
  vendorId,
  companyId,
  certifications,
  canWrite,
}: Props) {
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const attach = useAttachVendorCertification(vendorId);
  const remove = useRemoveVendorCertification(vendorId);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file first");
      return;
    }
    if (!name.trim()) {
      toast.error("Certification name is required");
      return;
    }
    setUploading(true);
    try {
      const path = `${companyId}/vendor-certs/${vendorId}/${Date.now()}-${safeName(
        file.name,
      )}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw upErr;
      await attach.mutateAsync({
        name: name.trim(),
        issuer: issuer.trim() || null,
        expires_at: expiresAt || null,
        file_path: path,
      });
      setName("");
      setIssuer("");
      setExpiresAt("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function openCert(path: string) {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 60 * 15);
    if (error || !data?.signedUrl) {
      toast.error("Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="font-display text-sm font-semibold">Certifications</h4>
        <p className="text-xs text-muted-foreground">
          ISO, IEC, IECRE, UL, quality certificates. Files land under{" "}
          <code className="rounded bg-muted px-1 text-[10px]">
            {companyId}/vendor-certs/{vendorId}/
          </code>
          .
        </p>
      </div>

      {certifications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No certifications on file.
        </p>
      ) : (
        <ul className="space-y-2">
          {certifications.map((c) => (
            <li
              key={c.file_path}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openCert(c.file_path)}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {c.name}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.issuer ?? "Unknown issuer"}
                    {c.expires_at ? ` · expires ${c.expires_at}` : ""}
                  </p>
                </div>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(c.file_path)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="cert-name">Name *</Label>
              <Input
                id="cert-name"
                placeholder="ISO 9001:2015"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-issuer">Issuer</Label>
              <Input
                id="cert-issuer"
                placeholder="TÜV, DNV, …"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-expiry">Expiry</Label>
              <Input
                id="cert-expiry"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="md:col-span-4">
              <Input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload certification
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
