// GC-16d — Calendar governance server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  calendarGovernanceQuerySchema,
  holidayImportSchema,
  holidaySetDecisionSchema,
  holidaySetSchema,
  policyChangeDecisionSchema,
  policyChangeRequestSchema,
  recalcSchema,
} from "@/lib/calendar-governance.rules";
import {
  decideHolidaySet,
  decidePolicyChange,
  importHolidayDates,
  loadCalendarGovernance,
  previewPolicyImpact,
  recalculateDeadlines,
  requestPolicyChange,
  resolveCalendarAccess,
  saveHolidaySet,
  type CalendarAccess,
  type CalendarGovernanceView,
} from "@/lib/calendar-governance.server";

const impactSchema = z.object({
  scope: z.enum(["company", "contract"]),
  contract_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  to_calendar_id: z.enum(["iso-std", "mena-jo", "mena-gulf", "mena-eg"]),
});

export const getCalendarAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<CalendarAccess> => {
    requireSupabaseAuth(context);
    return resolveCalendarAccess(context);
  });

export const getCalendarGovernance = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => calendarGovernanceQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<CalendarGovernanceView> => {
    requireSupabaseAuth(context);
    return loadCalendarGovernance(context, data);
  });

export const previewCalendarPolicyImpact = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => impactSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return previewPolicyImpact(context, data);
  });

export const requestCalendarPolicyChange = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => policyChangeRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return requestPolicyChange(context, data);
  });

export const decideCalendarPolicyChange = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => policyChangeDecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return decidePolicyChange(context, data);
  });

export const saveCalendarHolidaySet = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => holidaySetSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveHolidaySet(context, data);
  });

export const importCalendarHolidayDates = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => holidayImportSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return importHolidayDates(context, data);
  });

export const decideCalendarHolidaySet = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => holidaySetDecisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return decideHolidaySet(context, data);
  });

export const recalculateContractDeadlines = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => recalcSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return recalculateDeadlines(context, data);
  });
