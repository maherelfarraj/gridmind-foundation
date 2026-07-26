// P-174 — Alarm console server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assignAlarm,
  loadAlarmConsole,
  updateAlarmRca,
  type ConsolePayload,
} from "@/lib/alarm-console.server";
import { ALARM_SEVERITIES, ALARM_STATUSES } from "@/lib/alarms.rules";
import { assignAlarmSchema, rcaUpdateSchema } from "@/lib/scada/alarm-workflow";

export const getAlarmConsole = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        status: z.enum(ALARM_STATUSES).optional(),
        severity: z.enum(ALARM_SEVERITIES).optional(),
        projectId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<ConsolePayload> => {
    requireSupabaseAuth(context);
    return loadAlarmConsole(context, data);
  });

export const assignAlarmOwner = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => assignAlarmSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return assignAlarm(context, data);
  });

export const updateAlarmRootCause = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => rcaUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return updateAlarmRca(context, data);
  });
