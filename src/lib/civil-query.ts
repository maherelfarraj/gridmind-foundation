// P-161 — TanStack Query wiring for the civil analysis panel.
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import type { CivilFeatureRow } from "@/lib/civil.functions";

export function civilFeaturesQueryOptions(
  fn: (opts: {
    data: { projectId: string; surfaceId?: string | null };
  }) => Promise<CivilFeatureRow[]>,
  projectId: string,
) {
  return {
    queryKey: ["civil-features", projectId] as const,
    queryFn: () => fn({ data: { projectId } }),
  };
}

export function parseServerError(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;
  const body = (err as { body?: unknown }).body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed?.message) return parsed.message;
    } catch {
      // fall through
    }
  }
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message ? message : fallback;
}

export function useInvalidateCivilFeatures(projectId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["civil-features", projectId] });
}

export function useCivilMutation<TInput, TResult>(
  fn: (opts: { data: TInput }) => Promise<TResult>,
  options?: { onSuccess?: (result: TResult) => void; onError?: (message: string) => void },
): UseMutationResult<TResult, unknown, TInput> {
  return useMutation({
    mutationFn: (input: TInput) => fn({ data: input }),
    onSuccess: options?.onSuccess,
    onError: (err) => options?.onError?.(parseServerError(err)),
  });
}
