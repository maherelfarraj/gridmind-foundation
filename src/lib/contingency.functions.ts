// GC-14 — Contingency & risk exposure server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  movementCreateSchema,
  movementDecisionSchema,
  poolCreateSchema,
  poolUpdateSchema,
  riskQuantSchema,
} from "@/lib/contingency.rules";
import {
  createMovement,
  createPool,
  decideMovement,
  deleteMovement,
  loadContingencyWorkspace,
  resolveContingencyAccess,
  updatePool,
  upsertRiskQuantification,
  type ContingencyAccess,
  type ContingencyWorkspace,
} from "@/lib/contingency.server";

const projectInput = z.object({ project_id: z.string().uuid() });

export const getContingencyAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ContingencyAccess> => {
    requireSupabaseAuth(context);
    return resolveContingencyAccess(context);
  });

export const getContingencyWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }): Promise<ContingencyWorkspace> => {
    requireSupabaseAuth(context);
    return loadContingencyWorkspace(context, data.project_id);
  });

export const createContingencyPool = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => poolCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return { id: await createPool(context, data) };
  });

export const updateContingencyPool = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => poolUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await updatePool(context, data);
    return { ok: true };
  });

export const requestContingencyMovement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => movementCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return { id: await createMovement(context, data) };
  });

export const decideContingencyMovement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => movementDecisionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await decideMovement(context, data);
    return { ok: true };
  });

export const deleteContingencyMovement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await deleteMovement(context, data.id);
    return { ok: true };
  });

export const saveRiskQuantification = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => riskQuantSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await upsertRiskQuantification(context, data);
    return { ok: true };
  });
