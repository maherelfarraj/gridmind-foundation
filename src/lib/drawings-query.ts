// P-053 — React Query hooks for drawing register.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  createDrawing,
  createMarkup,
  decideDrawingSignoff,
  getDrawing,
  getMyDrawingRoles,
  getRevisionDownloadUrl,
  getRevisionUploadUrl,
  listDrawingSignoffs,
  listDrawings,
  listMarkups,
  registerDrawingRevision,
  requestDrawingSignoff,
  transitionDrawingStatus,
  updateMarkupStatus,
  type DrawingDiscipline,
  type DrawingStatus,
} from "@/lib/drawings.functions";

export interface DrawingsFilters {
  search?: string | null;
  discipline?: DrawingDiscipline | null;
  status?: DrawingStatus | null;
  limit?: number;
  offset?: number;
}

export function drawingsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listDrawings>>,
  projectId: string,
  filters: DrawingsFilters,
) {
  return queryOptions({
    queryKey: ["drawings", projectId, filters],
    queryFn: () =>
      fn({
        data: {
          projectId,
          search: filters.search ?? null,
          discipline: filters.discipline ?? null,
          status: filters.status ?? null,
          limit: filters.limit ?? 100,
          offset: filters.offset ?? 0,
        },
      }),
    staleTime: 30_000,
  });
}

export function drawingQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getDrawing>>,
  drawingId: string,
) {
  return queryOptions({
    queryKey: ["drawing", drawingId],
    queryFn: () => fn({ data: { drawingId } }),
    staleTime: 15_000,
  });
}

export function drawingRolesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyDrawingRoles>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["drawing-roles", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function drawingSignoffsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listDrawingSignoffs>>,
  drawingId: string,
) {
  return queryOptions({
    queryKey: ["drawing-signoffs", drawingId],
    queryFn: () => fn({ data: { drawingId } }),
    staleTime: 15_000,
  });
}

export function markupsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listMarkups>>,
  revisionId: string,
) {
  return queryOptions({
    queryKey: ["markups", revisionId],
    queryFn: () => fn({ data: { revisionId } }),
    staleTime: 15_000,
  });
}

export function useCreateDrawing(projectId: string) {
  const fn = useServerFn(createDrawing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      drawingNumber: string;
      title: string;
      discipline: DrawingDiscipline;
    }) => fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drawings", projectId] });
      toast.success("Drawing created");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Create failed"),
  });
}

export function useGetRevisionUploadUrl() {
  const fn = useServerFn(getRevisionUploadUrl);
  return useMutation({
    mutationFn: (input: {
      drawingId: string;
      fileName: string;
      fileSize: number;
      mimeType: string | null;
    }) => fn({ data: input }),
  });
}

export function useRegisterDrawingRevision(drawingId: string, projectId: string) {
  const fn = useServerFn(registerDrawingRevision);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      revisionCode: string;
      storagePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string | null;
      issueReason?: string | null;
    }) => fn({ data: { drawingId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drawing", drawingId] });
      qc.invalidateQueries({ queryKey: ["drawings", projectId] });
      toast.success("Revision uploaded");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Upload failed"),
  });
}

export function useTransitionDrawingStatus(drawingId: string, projectId: string) {
  const fn = useServerFn(transitionDrawingStatus);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { revisionId: string; toStatus: DrawingStatus }) =>
      fn({ data: { drawingId, ...input } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["drawing", drawingId] });
      qc.invalidateQueries({ queryKey: ["drawings", projectId] });
      toast.success(`Status → ${res.toStatus}`);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Transition failed";
      toast.error(msg);
    },
  });
}

export function useRequestDrawingSignoff(drawingId: string) {
  const fn = useServerFn(requestDrawingSignoff);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string | null }) =>
      fn({ data: { drawingId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drawing-signoffs", drawingId] });
      toast.success("Sign-off requested");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Request failed"),
  });
}

export function useDecideDrawingSignoff(drawingId: string) {
  const fn = useServerFn(decideDrawingSignoff);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      instanceId: string;
      decision: "approved" | "rejected";
      comment?: string | null;
    }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drawing-signoffs", drawingId] });
      toast.success("Sign-off recorded");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Decision failed"),
  });
}

export function useCreateMarkup(revisionId: string) {
  const fn = useServerFn(createMarkup);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      pageNumber?: number;
      reviewerOrg?: "client" | "lender" | "utility" | "internal";
      annotation: {
        coords: { x: number; y: number };
        color?: string;
        comment?: string;
        type?: string;
      };
    }) =>
      fn({
        data: {
          revisionId,
          pageNumber: input.pageNumber ?? 1,
          reviewerOrg: input.reviewerOrg ?? "internal",
          annotation: {
            coords: input.annotation.coords,
            color: input.annotation.color,
            comment: input.annotation.comment ?? "",
            type: input.annotation.type ?? "pin",
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markups", revisionId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Markup failed"),
  });
}

export function useUpdateMarkupStatus(revisionId: string) {
  const fn = useServerFn(updateMarkupStatus);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      markupId: string;
      status: "open" | "accepted" | "rejected" | "resolved";
      resolutionNote?: string | null;
    }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markups", revisionId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });
}

export function useDownloadRevision() {
  const fn = useServerFn(getRevisionDownloadUrl);
  return useMutation({
    mutationFn: (revisionId: string) => fn({ data: { revisionId } }),
    onSuccess: (res) => {
      if (res.url && typeof window !== "undefined") {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Download link unavailable");
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Download failed"),
  });
}
