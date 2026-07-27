// P-191 — Change-control blocking hook. Advisory UI over the server-side guard.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { getChangeControlStatus } from "@/lib/moc.exec.functions";

export interface BlockingChange {
  id: string;
  cr_number: string;
  title: string;
  status: string;
  change_type: string;
}

export interface ChangeControlState {
  blocked: boolean;
  changes: BlockingChange[];
  isPending: boolean;
}

/**
 * TRUE while any non-closed change request lists the entity in affected systems
 * or impacts it through the digital thread. Fails closed while loading is done —
 * the server re-checks anyway.
 */
export function useUnderChangeControl(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): ChangeControlState {
  const enabled = Boolean(entityType && entityId);
  const detailFn = useServerFn(getChangeControlStatus);

  const flag = useQuery({
    queryKey: ["change-control", entityType, entityId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_under_change_control", {
        p_entity_type: entityType!,
        p_entity_id: entityId!,
      });
      if (error) throw error;
      return data === true;
    },
  });

  const detail = useQuery({
    queryKey: ["change-control", "detail", entityType, entityId],
    enabled: enabled && flag.data === true,
    queryFn: () => detailFn({ data: { entityType: entityType!, entityId: entityId! } }),
  });

  return {
    blocked: flag.data === true,
    changes: (detail.data?.changes ?? []) as BlockingChange[],
    isPending: flag.isPending,
  };
}
