// P-174 — BESS + curtailment strip server function (thin wrapper only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { loadBessCurtailmentStrip, type BessCurtailmentStrip } from "@/lib/scada-bess.server";

export const getBessCurtailmentStrip = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<BessCurtailmentStrip> => {
    requireSupabaseAuth(context);
    return loadBessCurtailmentStrip(context, data.projectId);
  });
