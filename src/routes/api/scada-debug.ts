import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/scada-debug")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient<Database>(url, key, {
          auth: { persistSession: false },
          global: {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
              h.set("apikey", key);
              return fetch(input, { ...init, headers: h });
            },
          },
        });

        const now = new Date();
        const { data: telemetry } = await supabase
          .from("scada_telemetry")
          .select("scada_asset_id, ts, metric, value")
          .order("ts", { ascending: false })
          .limit(20);

        const { data: dbNow } = await supabase.rpc("now" as any);
        const { data: dbNowQuery } = await supabase.from("scada_telemetry").select("now()").limit(1).maybeSingle();

        return Response.json({
          serverNow: now.toISOString(),
          serverNowMs: now.getTime(),
          telemetryCount: telemetry?.length ?? 0,
          latestTelemetry: telemetry?.[0] ?? null,
          dbNow,
          dbNowQuery,
        });
      },
    },
  },
});
