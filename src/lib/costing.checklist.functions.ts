// GC-07 — Server functions for the Period Close Cockpit.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  checklistItemUpdateSchema,
  closeCockpitQuerySchema,
  evidenceLinkSchema,
  evidenceUnlinkSchema,
  type ChecklistItem,
  type CloseException,
} from "@/lib/costing.checklist";
import { exceptionResolveSchema } from "@/lib/costing.checklist";
import {
  linkEvidence,
  loadCloseCockpit,
  resolveException,
  unlinkEvidence,
  updateChecklistItem,
  type CloseCockpitData,
} from "@/lib/costing.checklist.server";

export type { CloseCockpitData };

export const getCloseCockpit = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => closeCockpitQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<CloseCockpitData> => {
    requireSupabaseAuth(context);
    return loadCloseCockpit(context, data.projectId, data.period);
  });

export const setChecklistItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => checklistItemUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ item: ChecklistItem; notified: number }> => {
    requireSupabaseAuth(context);
    return updateChecklistItem(context, data);
  });

export const setExceptionStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => exceptionResolveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ exception: CloseException; notified: number }> => {
    requireSupabaseAuth(context);
    return resolveException(context, data);
  });

export const attachChecklistEvidence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evidenceLinkSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return linkEvidence(context, {
      itemId: data.itemId,
      documentId: data.documentId,
      label: data.label ?? null,
    });
  });

export const detachChecklistEvidence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evidenceUnlinkSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    return unlinkEvidence(context, data.evidenceId);
  });
