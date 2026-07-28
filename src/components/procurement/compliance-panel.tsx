// P-260 — Compliance register panel. Shared by the subcontract detail tab and
// the vendor profile (one vendor, both lenses).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import { listComplianceDocs } from "@/lib/sub-compliance.functions";
import {
  complianceDocsQueryOptions,
  useDeleteComplianceDoc,
  useSaveComplianceDoc,
} from "@/lib/sub-compliance-query";
import {
  COMPLIANCE_DOC_TYPES,
  complianceGate,
  todayIso,
  type ComplianceDocType,
} from "@/lib/sub-compliance.rules";

export interface CompliancePanelProps {
  vendorId: string;
  /** When set the panel scopes to one subcontract (plus vendor-level umbrella docs). */
  subcontractId?: string | null;
  canWrite: boolean;
}

export function CompliancePanel({ vendorId, subcontractId, canWrite }: CompliancePanelProps) {
  const { t } = useI18n();
  const listFn = useServerFn(listComplianceDocs);
  const [open, setOpen] = useState(false);
  const { data: docs = [] } = useQuery(
    complianceDocsQueryOptions(listFn, {
      vendor_id: vendorId,
      subcontract_id: subcontractId ?? null,
      include_vendor_level: Boolean(subcontractId),
    }),
  );
  const remove = useDeleteComplianceDoc();

  const blocked = useMemo(
    () => (subcontractId ? complianceGate(docs, subcontractId) : null),
    [docs, subcontractId],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          {t("procurementMod.subcontracts.compliance.title")}
        </CardTitle>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t("procurementMod.subcontracts.compliance.add")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {blocked ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("procurementMod.subcontracts.compliance.blocked")}</span>
          </div>
        ) : null}

        {docs.length === 0 ? (
          <EmptyState
            title={t("procurementMod.subcontracts.compliance.empty")}
            description={t("procurementMod.subcontracts.compliance.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurementMod.subcontracts.compliance.docType")}</TableHead>
                <TableHead>{t("procurementMod.subcontracts.compliance.docTitle")}</TableHead>
                <TableHead>{t("procurementMod.subcontracts.compliance.issueDate")}</TableHead>
                <TableHead>{t("procurementMod.subcontracts.compliance.expiryDate")}</TableHead>
                <TableHead>{t("procurementMod.common.status")}</TableHead>
                {canWrite ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {t(`procurementMod.subcontracts.compliance.types.${d.doc_type}`)}
                    {d.mandatory ? (
                      <span className="ms-2 text-xs text-muted-foreground">
                        {t("procurementMod.subcontracts.compliance.mandatory")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{d.title}</TableCell>
                  <TableCell className="font-mono text-xs">{d.issue_date ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{d.expiry_date}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={d.status}
                      label={t(`procurementMod.subcontracts.compliance.status.${d.status}`)}
                    />
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("procurementMod.subcontracts.compliance.remove")}
                        onClick={() => remove.mutate(d.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ComplianceDialog
        open={open}
        onOpenChange={setOpen}
        vendorId={vendorId}
        subcontractId={subcontractId ?? null}
      />
    </Card>
  );
}

function ComplianceDialog({
  open,
  onOpenChange,
  vendorId,
  subcontractId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vendorId: string;
  subcontractId: string | null;
}) {
  const { t } = useI18n();
  const [docType, setDocType] = useState<ComplianceDocType>("insurance");
  const [title, setTitle] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState(todayIso());
  const save = useSaveComplianceDoc(() => {
    onOpenChange(false);
    setTitle("");
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("procurementMod.subcontracts.compliance.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("procurementMod.subcontracts.compliance.docType")}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as ComplianceDocType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLIANCE_DOC_TYPES.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {t(`procurementMod.subcontracts.compliance.types.${ty}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="compliance-title">
              {t("procurementMod.subcontracts.compliance.docTitle")}
            </Label>
            <Input
              id="compliance-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="compliance-issue">
                {t("procurementMod.subcontracts.compliance.issueDate")}
              </Label>
              <Input
                id="compliance-issue"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compliance-expiry">
                {t("procurementMod.subcontracts.compliance.expiryDate")}
              </Label>
              <Input
                id="compliance-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("procurementMod.subcontracts.compliance.derivedHint")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("procurementMod.subcontracts.cancel")}
          </Button>
          <Button
            disabled={title.trim().length < 2 || !expiryDate || save.isPending}
            onClick={() =>
              save.mutate({
                vendor_id: vendorId,
                subcontract_id: subcontractId,
                doc_type: docType,
                title: title.trim(),
                expiry_date: expiryDate,
                issue_date: issueDate || null,
                mandatory: docType === "insurance",
              })
            }
          >
            {t("procurementMod.subcontracts.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
