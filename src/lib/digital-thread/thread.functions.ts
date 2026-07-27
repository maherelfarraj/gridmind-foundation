// P-188 — Digital-thread server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  loadEntityGraph,
  loadImpactById,
  loadImpactsForEntity,
  loadOrphanLinks,
  setImpactStatus,
} from "@/lib/digital-thread/thread.server";

export const getEntityThread = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        entityType: z.string().min(1).max(40),
        entityId: z.string().uuid(),
        depth: z.number().int().min(1).max(4).default(2),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const [graph, impacts, self] = await Promise.all([
      loadEntityGraph(context, data.entityType, data.entityId, data.depth),
      loadImpactsForEntity(context, data.entityType, data.entityId),
      data.entityType === "impact_assessment"
        ? loadImpactById(context, data.entityId)
        : Promise.resolve(null),
    ]);
    return { graph, impacts, self };
  });

export const updateImpactStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["acknowledged", "resolved", "dismissed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return setImpactStatus(context, data.id, data.status);
  });

export const listOrphanLinks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return { rows: await loadOrphanLinks(context) };
  });
