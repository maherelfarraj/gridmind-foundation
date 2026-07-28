// P-259 — Sub portal: my subcontracts register + compliance documents.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FileCheck2, HardHat, Loader2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  createSubComplianceUpload,
  listSubPortalSubcontracts,
  submitSubComplianceDocument,
} from "@/lib/sub-portal.functions";
import { validateUploadFile, VENDOR_DOC_ALLOWED_MIME } from "@/lib/vendor-uploads.rules";

export const Route = createFileRoute("/vendor/$vendorId/subcontracts/")({
  head: () => ({
    meta: [
      { title: "Subcontracts — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Your awarded subcontract packages, progress claims and retention held, with compliance document uploads.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubPortalListPage,
});

function SubPortalListPage() {
  const { t } = useI18n();
  const { vendorId } = Route.useParams();
  const listFn = useServerFn(listSubPortalSubcontracts);
  const list = useQuery({
    queryKey: ["sub-portal", "list", vendorId],
    queryFn: () => listFn({ data: { vendorId } }),
    retry: false,
  });

  const rows = list.data ?? [];
  const retentionHeld = rows.reduce((s, r) => s + Number(r.retention_held ?? 0), 0);
  const certified = rows.reduce((s, r) => s + Number(r.certified_to_date ?? 0), 0);
  const currency = rows[0]?.currency_code ?? "USD";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link to="/vendor/$vendorId" params={{ vendorId }}>
          <ArrowLeft className="me-2 size-4" />
          {t("portalMod.sub.backToDashboard")}
        </Link>
      </Button>

      <PageHeader title={t("portalMod.sub.listTitle")} description={t("portalMod.sub.listDesc")} />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label={t("portalMod.sub.kpiCertified")} value={formatMoney(certified, currency)} />
        <KpiTile
          label={t("portalMod.sub.kpiRetentionHeld")}
          value={formatMoney(retentionHeld, currency)}
        />
        <KpiTile label={t("portalMod.sub.colSc")} value={String(rows.length)} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t("portalMod.sub.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <VendorTableSkeleton />
          ) : list.isError ? (
            <VendorStateCard
              title={t("portalMod.sub.loadError")}
              description={t("portalMod.dashboard.couldntLoadTabDesc")}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={HardHat}
              title={t("portalMod.sub.emptyTitle")}
              description={t("portalMod.sub.emptyDesc")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portalMod.sub.colSc")}</TableHead>
                    <TableHead>{t("portalMod.sub.colProject")}</TableHead>
                    <TableHead>{t("portalMod.sub.colStatus")}</TableHead>
                    <TableHead className="text-end">{t("portalMod.sub.colValue")}</TableHead>
                    <TableHead className="text-end">{t("portalMod.sub.colCertified")}</TableHead>
                    <TableHead className="text-end">{t("portalMod.sub.colRetention")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.subcontract_number ?? "—"}
                        <span className="block text-xs text-muted-foreground">{r.title}</span>
                      </TableCell>
                      <TableCell>{r.project_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {formatMoney(r.contract_value, r.currency_code)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatMoney(r.certified_to_date, r.currency_code)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatMoney(r.retention_held, r.currency_code)}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/vendor/$vendorId/subcontracts/$subcontractId"
                            params={{ vendorId, subcontractId: r.id }}
                          >
                            {t("portalMod.sub.open")}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ComplianceUploadCard vendorId={vendorId} />
    </div>
  );
}

function ComplianceUploadCard({ vendorId }: { vendorId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const uploadFn = useServerFn(createSubComplianceUpload);
  const registerFn = useServerFn(submitSubComplianceDocument);
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
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
      return registerFn({
        data: {
          vendorId,
          path: target.path,
          title: title.trim(),
          ...(expiresOn ? { expiresOn } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success(t("portalMod.sub.complianceSuccess"));
      setTitle("");
      setExpiresOn("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["vendor-portal", "exchange-docs", vendorId] });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : errorCodeOf(err);
      toast.error(translateError(t, code, t("portalMod.documents.genericErrorToast")));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="size-4" aria-hidden />
          {t("portalMod.sub.complianceTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <p className="text-sm text-muted-foreground md:col-span-3">
          {t("portalMod.sub.complianceDesc")}
        </p>
        <div className="space-y-2">
          <Label htmlFor="comp-title">{t("portalMod.sub.complianceTitleLabel")}</Label>
          <Input
            id="comp-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("portalMod.sub.complianceTitlePlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="comp-file">{t("portalMod.sub.complianceFile")}</Label>
          <Input
            id="comp-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="comp-expiry">{t("portalMod.sub.complianceExpiry")}</Label>
          <Input
            id="comp-expiry"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </div>
        <div className="md:col-span-3">
          <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
            {upload.isPending ? (
              <Loader2 className="me-2 size-4 animate-spin" />
            ) : (
              <Upload className="me-2 size-4" />
            )}
            {t("portalMod.sub.complianceUpload")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
