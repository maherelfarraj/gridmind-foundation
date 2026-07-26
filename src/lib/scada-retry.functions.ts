// P-177 — Ingestion reliability server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { getIngestionQueueHealth, replayDeadLetters } from "@/lib/scada-retry.server";

export const getIngestionQueue = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return getIngestionQueueHealth(context, data.companyId);
  });

export const replayIngestionDeadLetters = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        ids: z.array(z.string().uuid()).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { assertIngestionWriter } = await import("@/lib/scada-ingestion.server");
    await assertIngestionWriter(context);
    return replayDeadLetters(context, data.companyId, data.ids ?? []);
  });
