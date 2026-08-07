// GC-09 — Portfolio saved-view server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  createSavedView,
  deleteSavedView,
  duplicateSavedView,
  listSavedViews,
  updateSavedView,
} from "@/lib/portfolio-views.server";
import {
  savedViewCreateSchema,
  savedViewDuplicateSchema,
  savedViewIdSchema,
  savedViewUpdateSchema,
  type SavedView,
} from "@/lib/portfolio-views.rules";

export const getSavedViews = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<SavedView[]> => {
    requireSupabaseAuth(context);
    return listSavedViews(context);
  });

export const createPortfolioView = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => savedViewCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<SavedView> => {
    requireSupabaseAuth(context);
    return createSavedView(context, data);
  });

export const updatePortfolioView = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => savedViewUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<SavedView> => {
    requireSupabaseAuth(context);
    return updateSavedView(context, data);
  });

export const duplicatePortfolioView = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => savedViewDuplicateSchema.parse(input))
  .handler(async ({ data, context }): Promise<SavedView> => {
    requireSupabaseAuth(context);
    return duplicateSavedView(context, data);
  });

export const deletePortfolioView = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => savedViewIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return deleteSavedView(context, data.id);
  });
