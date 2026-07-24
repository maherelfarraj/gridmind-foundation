// P-043 — React Query hooks for opportunity detail.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  deleteContact,
  deleteTenderEvent,
  getOpportunity,
  getOpportunityActivity,
  listContacts,
  listTenderEvents,
  postOpportunityNote,
  saveContact,
  saveTenderEvent,
  updateOpportunity,
} from "@/lib/opportunity.functions";

// ---- Query options ---------------------------------------------------------
export function opportunityDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getOpportunity>>,
  id: string,
) {
  return queryOptions({
    queryKey: ["crm", "opportunity", id],
    queryFn: () => fn({ data: { id } }),
    staleTime: 15_000,
  });
}

export function contactsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listContacts>>,
  opportunityId: string,
) {
  return queryOptions({
    queryKey: ["crm", "opportunity", opportunityId, "contacts"],
    queryFn: () => fn({ data: { opportunityId } }),
    staleTime: 30_000,
  });
}

export function tenderEventsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listTenderEvents>>,
  opportunityId: string,
) {
  return queryOptions({
    queryKey: ["crm", "opportunity", opportunityId, "tenders"],
    queryFn: () => fn({ data: { opportunityId } }),
    staleTime: 30_000,
  });
}

export function activityQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getOpportunityActivity>>,
  opportunityId: string,
) {
  return queryOptions({
    queryKey: ["crm", "opportunity", opportunityId, "activity"],
    queryFn: () => fn({ data: { opportunityId } }),
    staleTime: 10_000,
  });
}

// ---- Shared invalidator ----------------------------------------------------
function useInvalidateOpp(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["crm", "opportunity", id] });
    qc.invalidateQueries({ queryKey: ["crm", "opportunities"] });
    qc.invalidateQueries({ queryKey: ["crm", "kpis"] });
  };
}

// ---- Mutations -------------------------------------------------------------
export function useUpdateOpportunity(id: string) {
  const fn = useServerFn(updateOpportunity);
  const invalidate = useInvalidateOpp(id);
  return useMutation({
    mutationFn: (patch: Record<string, any>) => fn({ data: { id, patch } }),
    onSuccess: () => {
      toast.success("Opportunity updated");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Update failed"),
  });
}

export function useSaveContact(opportunityId: string) {
  const fn = useServerFn(saveContact);
  const invalidate = useInvalidateOpp(opportunityId);
  return useMutation({
    mutationFn: (vars: any) => fn({ data: { ...vars, opportunityId } }),
    onSuccess: () => {
      toast.success("Contact saved");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useDeleteContact(opportunityId: string) {
  const fn = useServerFn(deleteContact);
  const invalidate = useInvalidateOpp(opportunityId);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => {
      toast.success("Contact removed");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Delete failed"),
  });
}

export function useSaveTenderEvent(opportunityId: string) {
  const fn = useServerFn(saveTenderEvent);
  const invalidate = useInvalidateOpp(opportunityId);
  return useMutation({
    mutationFn: (vars: any) => fn({ data: { ...vars, opportunityId } }),
    onSuccess: () => {
      toast.success("Tender event saved");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useDeleteTenderEvent(opportunityId: string) {
  const fn = useServerFn(deleteTenderEvent);
  const invalidate = useInvalidateOpp(opportunityId);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => {
      toast.success("Event removed");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Delete failed"),
  });
}

export function usePostNote(opportunityId: string) {
  const fn = useServerFn(postOpportunityNote);
  const invalidate = useInvalidateOpp(opportunityId);
  return useMutation({
    mutationFn: (body: string) => fn({ data: { opportunityId, body } }),
    onSuccess: () => {
      toast.success("Note posted");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Post failed"),
  });
}
