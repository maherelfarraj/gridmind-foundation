// P-174 — Event timeline server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { loadEventTimeline, type TimelinePage } from "@/lib/scada-timeline.server";
import { SCADA_EVENT_SEVERITIES, SCADA_EVENT_TYPES } from "@/lib/scada/events";

export const getScadaEventTimeline = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        eventType: z.enum(SCADA_EVENT_TYPES).optional(),
        severity: z.enum(SCADA_EVENT_SEVERITIES).optional(),
        nodeId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(40),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<TimelinePage> => {
    requireSupabaseAuth(context);
    return loadEventTimeline(context, data);
  });
