// P-208 — TanStack Query options + error shaping for the GL export workspace.
import { queryOptions } from "@tanstack/react-query";

import { getGlWorkspace } from "@/lib/gl.functions";
import type { GlUnbalancedSource } from "@/lib/gl.rules";

export function glWorkspaceQueryOptions() {
  return queryOptions({
    queryKey: ["gl", "workspace"],
    queryFn: () => getGlWorkspace(),
    staleTime: 10_000,
  });
}

export interface GlErrorInfo {
  message: string;
  unbalanced: GlUnbalancedSource[];
  locked: boolean;
}

export function glErrorInfo(err: unknown): GlErrorInfo {
  const fallback = (err as Error)?.message ?? "Something went wrong.";
  const anyErr = err as { body?: unknown; code?: string; statusCode?: number };
  if (anyErr?.code === "export_locked" || anyErr?.statusCode === 423) {
    return {
      message: "Exports are locked for this company while an approval is pending.",
      unbalanced: [],
      locked: true,
    };
  }
  if (typeof anyErr?.body === "string") {
    try {
      const parsed = JSON.parse(anyErr.body) as {
        error?: string;
        message?: string;
        extra?: { unbalanced?: GlUnbalancedSource[] };
      };
      return {
        message: parsed.message ?? fallback,
        unbalanced: parsed.extra?.unbalanced ?? [],
        locked: parsed.error === "export_locked",
      };
    } catch {
      /* fall through */
    }
  }
  return { message: fallback, unbalanced: [], locked: false };
}
