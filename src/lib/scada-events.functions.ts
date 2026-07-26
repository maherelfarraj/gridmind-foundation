// P-173 — SCADA event log server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { listScadaEvents, logOperatorEvent } from "@/lib/scada-events.server";
import { operatorEventSchema } from "@/lib/scada/events";

export const logScadaEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => operatorEventSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return logOperatorEvent(context, data);
  });

export const listProjectScadaEvents = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ projectId: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return { events: await listScadaEvents(context, data.projectId, data.limit ?? 200) };
  });
