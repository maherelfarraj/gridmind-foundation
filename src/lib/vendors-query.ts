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

export function useCreateVendor() {
  const qc = useQueryClient();
  const fn = useServerFn(createVendor);
  return useMutation({
    mutationFn: (input: Parameters<typeof fn>[0]["data"]) => fn({ data: input }),
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
    mutationFn: (patch: Parameters<typeof fn>[0]["data"]["patch"]) =>
      fn({ data: { id: vendorId, patch } }),
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
    mutationFn: (
      certification: Parameters<typeof fn>[0]["data"]["certification"],
    ) => fn({ data: { vendorId, certification } }),
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
