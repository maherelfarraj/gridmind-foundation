// P-061 — TanStack Query wrappers for vendors.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  attachVendorCertification,
  changeVendorStatus,
  createVendor,
  getVendor,
  getVendorWriteAccess,
  listCurrencyCodes,
  listVendors,
  removeVendorCertification,
  updateVendor,
  type VendorStatus,
} from "@/lib/vendors.functions";

export interface VendorFilters {
  search?: string | null;
  status?: VendorStatus | null;
}

export function vendorsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listVendors>>,
  filters: VendorFilters,
) {
  return queryOptions({
    queryKey: ["vendors", filters],
    queryFn: () =>
      fn({
        data: {
          search: filters.search ?? null,
          status: filters.status ?? null,
        },
      }),
    staleTime: 30_000,
  });
}

export function vendorDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getVendor>>,
  id: string,
) {
  return queryOptions({
    queryKey: ["vendor", id],
    queryFn: () => fn({ data: { id } }),
    staleTime: 15_000,
  });
}

export function currencyCodesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listCurrencyCodes>>,
) {
  return queryOptions({
    queryKey: ["currency-codes"],
    queryFn: () => fn({}),
    staleTime: 60 * 60_000,
  });
}

export function vendorWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getVendorWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["vendor-write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

function errorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      // ignore
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}

export interface VendorIdentityInput {
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line?: string | null;
  city?: string | null;
  country?: string | null;
  currency_code?: string | null;
  payment_terms?: "net_15" | "net_30" | "net_45" | "net_60" | null;
  incoterms?: "DAP" | "DDP" | "FOB" | "CIF" | "EXW" | "FCA" | "CPT" | null;
  categories?: string[];
  notes?: string | null;
}

export interface CertificationInput {
  name: string;
  issuer?: string | null;
  expires_at?: string | null;
  file_path: string;
}

export function useCreateVendor() {
  const qc = useQueryClient();
  const fn = useServerFn(createVendor);
  return useMutation({
    mutationFn: (input: VendorIdentityInput) => fn({ data: input as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor onboarded");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateVendor(vendorId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(updateVendor);
  return useMutation({
    mutationFn: (patch: Partial<VendorIdentityInput>) =>
      fn({ data: { id: vendorId, patch: patch as any } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useChangeVendorStatus(vendorId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(changeVendorStatus);
  return useMutation({
    mutationFn: (status: VendorStatus) => fn({ data: { id: vendorId, status } }),
    onSuccess: (_res, status) => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success(`Vendor status set to ${status.replace("_", " ")}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useAttachVendorCertification(vendorId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(attachVendorCertification);
  return useMutation({
    mutationFn: (certification: CertificationInput) => fn({ data: { vendorId, certification } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      toast.success("Certification attached");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRemoveVendorCertification(vendorId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(removeVendorCertification);
  return useMutation({
    mutationFn: (filePath: string) => fn({ data: { vendorId, filePath } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      toast.success("Certification removed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
