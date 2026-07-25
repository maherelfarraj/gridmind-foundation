// P-061 — Vendor detail / edit page.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VendorForm } from "@/components/procurement/vendor-form";
import { VendorCertifications } from "@/components/procurement/vendor-certifications";
import {
  getVendor,
  getVendorWriteAccess,
  VENDOR_STATUSES,
  type VendorStatus,
} from "@/lib/vendors.functions";
import {
  useChangeVendorStatus,
  useUpdateVendor,
  vendorDetailQueryOptions,
  vendorWriteAccessQueryOptions,
} from "@/lib/vendors-query";

export const Route = createFileRoute("/_authenticated/procurement/vendors/$vendorId")({
  head: () => ({
    meta: [
      { title: "Vendor — GridMind EPC" },
      {
        name: "description",
        content: "Edit vendor details, manage status, and attach certifications.",
      },
      { property: "og:title", content: "Vendor — GridMind EPC" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: VendorDetail,
  notFoundComponent: () => (
    <div className="py-16 text-center text-sm text-muted-foreground">Vendor not found.</div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load vendor</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  ),
});

function VendorDetail() {
  const { vendorId } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getVendor);
  const accessFn = useServerFn(getVendorWriteAccess);

  const vendorQuery = useSuspenseQuery(vendorDetailQueryOptions(getFn, vendorId));
  const accessQuery = useSuspenseQuery(vendorWriteAccessQueryOptions(accessFn));
  const vendor = vendorQuery.data;
  const canWrite = accessQuery.data.canWrite;

  const update = useUpdateVendor(vendorId);
  const changeStatus = useChangeVendorStatus(vendorId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/procurement/vendors" })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to vendors
          </Button>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight">{vendor.name}</h1>
            <Badge variant="outline" className="capitalize">
              {vendor.status.replace("_", " ")}
            </Badge>
          </div>
          {vendor.legal_name && (
            <p className="text-sm text-muted-foreground">{vendor.legal_name}</p>
          )}
        </div>
        {canWrite && (
          <div className="w-52 space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Status</label>
            <Select
              value={vendor.status}
              onValueChange={(v) => changeStatus.mutate(v as VendorStatus)}
              disabled={changeStatus.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDOR_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <VendorForm
          initial={vendor}
          submitting={update.isPending}
          submitLabel="Save changes"
          disabled={!canWrite}
          onSubmit={(input) => update.mutate(input)}
        />
      </div>

      <VendorCertifications
        vendorId={vendor.id}
        companyId={vendor.company_id}
        certifications={vendor.certifications}
        canWrite={canWrite}
      />
    </div>
  );
}
