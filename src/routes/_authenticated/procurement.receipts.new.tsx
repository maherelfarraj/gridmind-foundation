// P-066 — New goods receipt form (mobile-friendly).
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Num } from "@/components/ui/num";
import { supabase } from "@/integrations/supabase/client";
import { createDraftGrn, getReceivableForPo, listReceivablePos } from "@/lib/grn.functions";
import {
  GRN_CONDITIONS,
  overReceivedLines,
  type GrnCondition,
  type GrnLine,
  type ReceivableLine,
} from "@/lib/grn-rules";
import {
  receivableForPoQueryOptions,
  receivablePosQueryOptions,
  useConfirmGrn,
  useCreateDraftGrn,
  useSaveGrnDraft,
} from "@/lib/grn-query";
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";

const searchSchema = z.object({
  po: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/procurement/receipts/new")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "New Goods Receipt — GridMind EPC" },
      {
        name: "description",
        content:
          "Receive goods against an issued purchase order — record quantities, lot IDs, defects, and photos.",
      },
    ],
  }),
  component: NewReceipt,
});

function NewReceipt() {
  const { t } = useI18n();
  const { po } = useSearch({
    from: "/_authenticated/procurement/receipts/new",
  });
  const navigate = useNavigate();

  const listFn = useServerFn(listReceivablePos);
  const posQuery = useSuspenseQuery(receivablePosQueryOptions(listFn));

  if (!po) {
    return (
      <div className="page-shell max-w-lg">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/receipts" })}>
          <ArrowLeft className="me-2 h-4 w-4" /> {t("procurementMod.grn.backToReceipts")}
        </Button>
        <h1 className="font-display text-xl font-semibold">
          {t("procurementMod.grn.pickPoTitle")}
        </h1>
        {posQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("procurementMod.grn.noOpenPos")}</p>
        ) : (
          <div className="space-y-2">
            {posQuery.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  navigate({
                    to: "/procurement/receipts/new",
                    search: { po: p.id },
                  })
                }
                className="flex w-full items-center justify-between rounded-md border border-border p-3 text-start hover:bg-accent"
              >
                <div>
                  <div className="font-mono text-sm">{p.po_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.vendor_name ?? t("procurementMod.grn.vendorFallback")}
                  </div>
                </div>
                <Badge variant="outline">{t(`procurementMod.grn.poStatuses.${p.status}`)}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <ReceivingForm poId={po} />;
}

interface DraftContext {
  grnId: string;
  companyId: string;
}

function ReceivingForm({ poId }: { poId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const receivableFn = useServerFn(getReceivableForPo);
  const receivableQuery = useSuspenseQuery(receivableForPoQueryOptions(receivableFn, poId));
  const receivable = receivableQuery.data.receivable;

  const createDraft = useCreateDraftGrn();
  const [draft, setDraft] = useState<DraftContext | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (draft || creating) return;
    setCreating(true);
    createDraft
      .mutateAsync(poId)
      .then((res) => setDraft({ grnId: res.id, companyId: res.company_id }))
      .catch(() => {
        /* toast fires from hook */
      })
      .finally(() => setCreating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  if (creating || !draft) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("procurementMod.grn.preparingReceipt")}
      </div>
    );
  }

  return (
    <ReceivingEditor
      poId={poId}
      poNumber={receivableQuery.data.po_number}
      receivable={receivable}
      grnId={draft.grnId}
      companyId={draft.companyId}
      onDone={() =>
        navigate({
          to: "/procurement/receipts/$grnId",
          params: { grnId: draft.grnId },
        })
      }
      onCancel={() => navigate({ to: "/procurement/receipts" })}
    />
  );
}

function makeInitialLines(receivable: ReceivableLine[]): GrnLine[] {
  return receivable.map((r) => ({
    po_line_no: r.po_line_no,
    description: r.description,
    uom: r.uom,
    qty_ordered: r.qty_ordered,
    qty_received: r.qty_remaining,
    lot_ids: [],
    condition: "ok" as GrnCondition,
    defect_notes: null,
  }));
}

function ReceivingEditor({
  poId,
  poNumber,
  receivable,
  grnId,
  companyId,
  onDone,
  onCancel,
}: {
  poId: string;
  poNumber: string;
  receivable: ReceivableLine[];
  grnId: string;
  companyId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [lines, setLines] = useState<GrnLine[]>(() => makeInitialLines(receivable));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  // P-233 — GPS stamp captured at the moment of receipt.
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy_m: number | null } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);

  const captureGeo = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(t("procurementMod.grn.locationNotAvailable"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy_m: pos.coords.accuracy == null ? null : Math.round(pos.coords.accuracy),
        });
        setLocating(false);
        toast.success(t("procurementMod.grn.locationCaptured"));
      },
      (err) => {
        setLocating(false);
        const code = errorCodeOf(err) ?? (err?.code === 1 ? "gps_outside_geofence" : null);
        toast.error(
          code === "gps_outside_geofence"
            ? translateError(t, code, null)
            : t("procurementMod.grn.locationReadFailed"),
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const saveDraft = useSaveGrnDraft(grnId);
  const confirm = useConfirmGrn(grnId);

  const badLines = useMemo(() => overReceivedLines(lines, receivable), [lines, receivable]);
  const anyDefectMissingNote = lines.some(
    (l) => l.condition !== "ok" && !(l.defect_notes ?? "").trim(),
  );
  const canConfirm =
    badLines.length === 0 && !anyDefectMissingNote && lines.some((l) => l.qty_received > 0);

  const updateLine = (no: number, patch: Partial<GrnLine>) => {
    setLines((prev) => prev.map((l) => (l.po_line_no === no ? { ...l, ...patch } : l)));
  };

  const uploadPhoto = async (file: File) => {
    if (photos.length >= 10) {
      toast.error(t("procurementMod.grn.maxPhotos"));
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const path = `${companyId}/grn/${grnId}/${id}.${ext}`;
      const { error } = await supabase.storage
        .from("photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("photos").createSignedUrl(path, 600);
      setPhotos((p) => [...p, path]);
      if (signed?.signedUrl) {
        setPhotoUrls((m) => ({ ...m, [path]: signed.signedUrl }));
      }
    } catch (e: any) {
      toast.error(
        translateError(t, errorCodeOf(e), e?.message ?? t("procurementMod.grn.uploadFailed")),
      );
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (path: string) => {
    setPhotos((p) => p.filter((x) => x !== path));
    setPhotoUrls((m) => {
      const next = { ...m };
      delete next[path];
      return next;
    });
    supabase.storage
      .from("photos")
      .remove([path])
      .catch(() => undefined);
  };

  const payload = {
    lines,
    notes: notes.trim() ? notes.trim() : null,
    photos,
    geo,
  };

  return (
    <div className="page-shell max-w-3xl pb-32">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <ArrowLeft className="me-2 h-4 w-4" /> {t("procurementMod.grn.backToReceipts")}
      </Button>
      <PageHeader title={poNumber} description={t("procurementMod.grn.receiveAgainstPo")} />

      {badLines.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{t("procurementMod.grn.overReceivedWarning", { lines: badLines.join(", ") })}</span>
        </div>
      )}

      {lines.map((l) => {
        const r = receivable.find((x) => x.po_line_no === l.po_line_no);
        const remaining = r?.qty_remaining ?? 0;
        return (
          <Card key={l.po_line_no}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                <span className="font-mono text-xs text-muted-foreground">#{l.po_line_no}</span>{" "}
                {l.description}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("procurementMod.grn.ordered", {
                  qty: l.qty_ordered,
                  uom: l.uom,
                  remaining,
                })}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`qty-${l.po_line_no}`}>
                    {t("procurementMod.grn.colReceived")}
                  </Label>
                  <Input
                    id={`qty-${l.po_line_no}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={remaining}
                    step="any"
                    value={l.qty_received}
                    onChange={(e) =>
                      updateLine(l.po_line_no, {
                        qty_received: Number(e.target.value || 0),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("procurementMod.grn.colCondition")}</Label>
                  <Select
                    value={l.condition}
                    onValueChange={(v) =>
                      updateLine(l.po_line_no, {
                        condition: v as GrnCondition,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRN_CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`procurementMod.grn.conditions.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <LotIdInput
                lotIds={l.lot_ids}
                onChange={(v) => updateLine(l.po_line_no, { lot_ids: v })}
              />

              {l.condition !== "ok" && (
                <div className="space-y-1">
                  <Label htmlFor={`def-${l.po_line_no}`}>
                    {t("procurementMod.grn.defectNotesLabel")}
                  </Label>
                  <Textarea
                    id={`def-${l.po_line_no}`}
                    rows={2}
                    placeholder={t("procurementMod.grn.defectNotesPlaceholder")}
                    value={l.defect_notes ?? ""}
                    onChange={(e) =>
                      updateLine(l.po_line_no, {
                        defect_notes: e.target.value,
                      })
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("procurementMod.grn.photosLabel", { count: photos.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PhotoPicker onFile={uploadPhoto} disabled={uploading || photos.length >= 10} />
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((p) => (
                <div
                  key={p}
                  className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                >
                  {photoUrls[p] ? (
                    <img src={photoUrls[p]} alt="Delivery" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      {t("procurementMod.grn.uploaded")}
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={t("procurementMod.grn.removePhotoAria")}
                    onClick={() => removePhoto(p)}
                    className="absolute end-1 top-1 rounded-full bg-background/80 p-1 text-foreground opacity-0 transition group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("procurementMod.grn.receiptLocation")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={captureGeo} disabled={locating}>
            {locating
              ? t("procurementMod.grn.locating")
              : geo
                ? t("procurementMod.grn.recapture")
                : t("procurementMod.grn.captureGps")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {geo ? (
              <Num>
                {`${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}${
                  geo.accuracy_m != null ? ` · ±${geo.accuracy_m} m` : ""
                }`}
              </Num>
            ) : (
              t("procurementMod.grn.noGpsCaptured")
            )}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <Label htmlFor="grn-notes">{t("procurementMod.grn.notesLabel")}</Label>
        <Textarea
          id="grn-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("procurementMod.grn.notesPlaceholder")}
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={saveDraft.isPending}
            onClick={() => saveDraft.mutate(payload)}
          >
            <Save className="me-2 h-4 w-4" /> {t("procurementMod.grn.saveDraft")}
          </Button>
          <Button
            className="flex-1"
            disabled={!canConfirm || confirm.isPending || badLines.length > 0}
            onClick={() =>
              confirm.mutate(payload, {
                onSuccess: () => onDone(),
              })
            }
          >
            {confirm.isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="me-2 h-4 w-4" />
            )}
            {t("procurementMod.grn.confirmReceipt")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LotIdInput({
  lotIds,
  onChange,
}: {
  lotIds: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v) return;
    if (lotIds.includes(v)) {
      setValue("");
      return;
    }
    onChange([...lotIds, v]);
    setValue("");
  };
  return (
    <div className="space-y-1">
      <Label>{t("procurementMod.grn.lotSerialLabel")}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder={t("procurementMod.grn.lotSerialPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          {t("procurementMod.grn.add")}
        </Button>
      </div>
      {lotIds.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {lotIds.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              <span className="font-mono text-xs">{id}</span>
              <button
                type="button"
                aria-label={t("procurementMod.grn.removeLot", { id })}
                onClick={() => onChange(lotIds.filter((x) => x !== id))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoPicker({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const { t } = useI18n();
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex gap-2">
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        disabled={disabled}
        onClick={() => camRef.current?.click()}
      >
        <Camera className="me-2 h-4 w-4" /> {t("procurementMod.grn.camera")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="me-2 h-4 w-4" /> {t("procurementMod.grn.upload")}
      </Button>
    </div>
  );
}
