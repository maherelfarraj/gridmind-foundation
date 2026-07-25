// P-113 — Client-side helpers around the export lock RPCs.
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ExportType } from "@/lib/export-guard";

export interface ActiveExportLock {
  id: string;
  export_type: ExportType;
  reason: string;
  locked_at: string;
}

/**
 * True when the given (project, export_type) is currently blocked — either by
 * a manual lock or a pending approval instance with blocks_export=true.
 * Silent-safe when the migration is not applied (returns false).
 */
export function useIsExportLocked(
  projectId: string | null | undefined,
  exportType: ExportType,
) {
  return useQuery({
    queryKey: ["export-lock", projectId ?? null, exportType],
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<boolean> => {
      if (!projectId) return false;
      const { data, error } = await supabase.rpc("is_export_locked" as never, {
        p_project_id: projectId,
        p_export_type: exportType,
      } as never);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "42P01" || code === "42883") return false;
        return false;
      }
      return Boolean(data);
    },
  });
}

/**
 * All active locks for a project (unlocked_at IS NULL). Used by the
 * ExportLockBadge and the manual lock/unlock admin panel.
 */
export function useActiveExportLocks(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["export-locks", projectId ?? null],
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<ActiveExportLock[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("project_export_locks" as never)
        .select("id, export_type, reason, locked_at")
        .eq("project_id", projectId as never)
        .is("unlocked_at", null as never)
        .order("locked_at", { ascending: false });
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "42P01") return [];
        throw error;
      }
      return (data ?? []) as unknown as ActiveExportLock[];
    },
  });
}
