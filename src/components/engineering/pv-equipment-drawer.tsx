// P-150 — PV equipment detail drawer: specs, certifications, warranty, files.
import { useRef } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileUp, Pencil, Power, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import {
  DEGRADATION_FIELDS,
  DIMENSION_FIELDS,
  LIMIT_FIELDS,
  TEMP_COEFF_FIELDS,
  electricalFields,
  formatSpec,
  type NumField,
} from "@/components/engineering/pv-field-specs";
import { getPvEquipment } from "@/lib/pv-library.functions";
import {
  pvEquipmentDetailQueryOptions,
  useOpenPvFile,
  useRemovePvDoc,
  useSetPvEquipmentActive,
  useUploadPvFile,
} from "@/lib/pv-library-query";
import {
  PV_CATEGORY_LABELS,
  isCertificationExpired,
  type PvEquipmentRow,
} from "@/lib/pv-library.schemas";

function SpecGrid({ fields, values }: { fields: NumField[]; values: Record<string, any> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {fields.map((f) => (
        <div key={f.key}>
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className="text-sm font-medium text-foreground">
            {formatSpec(values?.[f.key], f.unit ?? "", 3)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailBody({
  row,
  canWrite,
  onEdit,
}: {
  row: PvEquipmentRow;
  canWrite: boolean;
  onEdit: (row: PvEquipmentRow) => void;
}) {
  const upload = useUploadPvFile(row.id);
  const removeDoc = useRemovePvDoc(row.id);
  const openFile = useOpenPvFile();
  const setActive = useSetPvEquipmentActive();
  const datasheetInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const terms = (row.warranties?.performance_terms as any[]) ?? [];

  return (
    <div className="space-y-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{PV_CATEGORY_LABELS[row.category]}</Badge>
        <Badge variant={row.is_active ? "default" : "outline"}>
          {row.is_active ? "Active" : "Inactive"}
        </Badge>
        {canWrite ? (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={setActive.isPending}
              onClick={() => setActive.mutate({ id: row.id, isActive: !row.is_active })}
            >
              <Power className="mr-2 h-4 w-4" />
              {row.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        ) : null}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Electrical</h3>
        <SpecGrid fields={electricalFields(row.category)} values={row.electrical} />
      </section>

      {row.category === "module" ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Temperature coefficients</h3>
          <SpecGrid fields={TEMP_COEFF_FIELDS} values={row.temp_coefficients} />
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Degradation</h3>
        <SpecGrid fields={DEGRADATION_FIELDS} values={row.degradation} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Limits</h3>
        <SpecGrid fields={LIMIT_FIELDS} values={row.limits} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Dimensions &amp; weight</h3>
        <SpecGrid fields={DIMENSION_FIELDS} values={row.dimensions} />
      </section>

      <Separator />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Certifications</h3>
        {row.certifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No certifications recorded.</p>
        ) : (
          <ul className="space-y-2">
            {row.certifications.map((c, i) => (
              <li
                key={`${c.standard}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm font-medium text-foreground">{c.standard}</span>
                {c.certificate_no ? (
                  <span className="text-xs text-muted-foreground">#{c.certificate_no}</span>
                ) : null}
                {c.valid_until ? (
                  <Badge
                    variant={isCertificationExpired(c.valid_until) ? "destructive" : "secondary"}
                    className="ml-auto"
                  >
                    {isCertificationExpired(c.valid_until) ? "Expired" : "Valid until"}{" "}
                    {c.valid_until}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Warranty</h3>
        <div className="rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Product</p>
              <p className="text-sm font-medium text-foreground">
                {formatSpec(row.warranties?.product_years, "years")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Performance</p>
              <p className="text-sm font-medium text-foreground">
                {formatSpec(row.warranties?.performance_years, "years")}
              </p>
            </div>
          </div>
          {terms.length > 0 ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-normal">Year</th>
                  <th className="pb-1 font-normal">Min output</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t: any, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1">{t.year}</td>
                    <td className="py-1">{formatSpec(t.min_output_pct, "%")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>

      <Separator />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Documents</h3>
        <div className="flex flex-wrap items-center gap-2">
          {row.datasheet_path ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openFile.mutate(row.datasheet_path!)}
            >
              <Download className="mr-2 h-4 w-4" /> Spec sheet
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">No spec sheet uploaded.</span>
          )}
          {canWrite ? (
            <>
              <input
                ref={datasheetInput}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate({ file, kind: "datasheet" });
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => datasheetInput.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                {upload.isPending ? "Uploading…" : "Upload spec sheet"}
              </Button>
              <input
                ref={docInput}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate({ file, kind: "doc" });
                  e.target.value = "";
                }}
              />
              <Button variant="ghost" size="sm" onClick={() => docInput.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" /> Add document
              </Button>
            </>
          ) : null}
        </div>
        {row.docs.length > 0 ? (
          <ul className="space-y-1">
            {row.docs.map((d) => (
              <li
                key={d.path}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="truncate text-sm text-foreground">{d.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => openFile.mutate(d.path)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canWrite ? (
                  <Button variant="ghost" size="sm" onClick={() => removeDoc.mutate(d.path)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

export function PvEquipmentDetailDrawer({
  equipmentId,
  onOpenChange,
  canWrite,
  onEdit,
}: {
  equipmentId: string | null;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  onEdit: (row: PvEquipmentRow) => void;
}) {
  const getFn = useServerFn(getPvEquipment);
  const query = useQuery(pvEquipmentDetailQueryOptions(getFn, equipmentId));

  return (
    <Sheet open={Boolean(equipmentId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {query.data ? `${query.data.manufacturer} ${query.data.model}` : "Equipment"}
          </SheetTitle>
          <SheetDescription>
            Full specification sheet, certifications, warranty and attached documents.
          </SheetDescription>
        </SheetHeader>
        {query.isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <p className="py-6 text-sm text-destructive">{(query.error as Error).message}</p>
        ) : query.data ? (
          <DetailBody row={query.data} canWrite={canWrite} onEdit={onEdit} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// Keeps the suspense import referenced for consistency with sibling drawers.
export type { PvEquipmentRow };
void useSuspenseQuery;
