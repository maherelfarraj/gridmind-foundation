// P-060 — React Query hooks for IFC releases.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  getIfcKpis,
  getIfcRelease,
  getMyIfcRole,
  listIfcReleases,
  listReleasableDrawings,
  notifyDistribution,
  prepareIfcRelease,
  releaseIfc,
  signIfcRelease,
  voidIfcRelease,
} from "@/lib/ifc-release.functions";

export function ifcReleasesListOptions(
  fn: ReturnType<typeof useServerFn<typeof listIfcReleases>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["ifc-releases", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function ifcReleaseDetailOptions(
  fn: ReturnType<typeof useServerFn<typeof getIfcRelease>>,
  releaseId: string,
) {
  return queryOptions({
    queryKey: ["ifc-release", releaseId],
    queryFn: () => fn({ data: { releaseId } }),
    staleTime: 15_000,
  });
}

export function releasableDrawingsOptions(
  fn: ReturnType<typeof useServerFn<typeof listReleasableDrawings>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["ifc-releasable", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 10_000,
  });
}

export function ifcKpisOptions(
  fn: ReturnType<typeof useServerFn<typeof getIfcKpis>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["ifc-kpis", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function myIfcRoleOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyIfcRole>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["ifc-my-role", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function usePrepareIfcRelease(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(prepareIfcRelease);
  return useMutation({
    mutationFn: (vars: {
      projectId: string;
      packageName: string;
      notes?: string;
      drawingIds: string[];
      distribution?: Array<{
        profile_id: string;
        name: string;
        email: string | null;
        org?: string | null;
      }>;
    }) => fn({ data: vars } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ifc-releases", projectId] });
      qc.invalidateQueries({ queryKey: ["ifc-releasable", projectId] });
      qc.invalidateQueries({ queryKey: ["ifc-kpis", projectId] });
      toast.success("IFC package prepared");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to prepare release"),
  });
}

export function useSignIfcRelease(releaseId: string, projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(signIfcRelease);
  return useMutation({
    mutationFn: (vars: {
      releaseId: string;
      roleLabel: "Lead Engineer" | "Engineering Manager" | "Project Director";
      signatureText: string;
    }) => fn({ data: vars } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ifc-release", releaseId] });
      qc.invalidateQueries({ queryKey: ["ifc-releases", projectId] });
      toast.success("Sign-off recorded");
    },
    onError: (err: any) => toast.error(err?.message ?? "Sign-off failed"),
  });
}

export function useReleaseIfc(releaseId: string, projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(releaseIfc);
  return useMutation({
    mutationFn: () => fn({ data: { releaseId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ifc-release", releaseId] });
      qc.invalidateQueries({ queryKey: ["ifc-releases", projectId] });
      qc.invalidateQueries({ queryKey: ["ifc-kpis", projectId] });
      qc.invalidateQueries({ queryKey: ["drawings", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("IFC package released");
    },
    onError: (err: any) => toast.error(err?.message ?? "Release failed"),
  });
}

export function useVoidIfcRelease(releaseId: string, projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(voidIfcRelease);
  return useMutation({
    mutationFn: (reason: string) => fn({ data: { releaseId, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ifc-release", releaseId] });
      qc.invalidateQueries({ queryKey: ["ifc-releases", projectId] });
      toast.success("Release voided");
    },
    onError: (err: any) => toast.error(err?.message ?? "Void failed"),
  });
}

export function useNotifyDistribution(releaseId: string) {
  const fn = useServerFn(notifyDistribution);
  return useMutation({
    mutationFn: () => fn({ data: { releaseId } }),
    onSuccess: (r) => toast.success(`Notified ${r?.sent ?? 0} recipient(s)`),
    onError: (err: any) => toast.error(err?.message ?? "Notification failed"),
  });
}
