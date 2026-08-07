// GC-16 — Contract & claims server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  claimAlertActionSchema,
  claimSnapshotBuildSchema,
  claimSnapshotTransitionSchema,
  claimTransitionSchema,
  claimUpsertSchema,
  claimValuationSchema,
  claimsWorkspaceSchema,
  deadlineSchema,
  portfolioClaimsSchema,
} from "@/lib/contracts-claims.rules";
import {
  actOnAlert,
  buildClaimSnapshot,
  loadClaimsAppendix,
  loadClaimsWorkspace,
  loadPortfolioClaims,
  refreshProjectAlerts,
  resolveClaimsAccess,
  saveClaim,
  saveDeadline,
  saveValuation,
  transitionClaim,
  transitionClaimSnapshot,
  type ClaimsAccess,
  type ClaimsAppendix,
  type ClaimsWorkspace,
  type PortfolioClaimsView,
} from "@/lib/contracts-claims.server";

export const getClaimsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ClaimsAccess> => {
    requireSupabaseAuth(context);
    return resolveClaimsAccess(context);
  });

export const getClaimsWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimsWorkspaceSchema.parse(input))
  .handler(async ({ data, context }): Promise<ClaimsWorkspace> => {
    requireSupabaseAuth(context);
    return loadClaimsWorkspace(context, data.project_id, data.period_month);
  });

export const getClaimsAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimsWorkspaceSchema.parse(input))
  .handler(async ({ data, context }): Promise<ClaimsAppendix> => {
    requireSupabaseAuth(context);
    return loadClaimsAppendix(context, data.project_id, data.period_month);
  });

export const getPortfolioClaims = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioClaimsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioClaimsView> => {
    requireSupabaseAuth(context);
    return loadPortfolioClaims(context, data);
  });

export const saveContractClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimUpsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveClaim(context, data);
  });

export const transitionContractClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimTransitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return transitionClaim(context, data);
  });

export const saveClaimValuation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimValuationSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveValuation(context, data);
  });

export const saveContractDeadline = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => deadlineSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return saveDeadline(context, data);
  });

export const buildContractClaimSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimSnapshotBuildSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return buildClaimSnapshot(context, data);
  });

export const transitionContractClaimSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimSnapshotTransitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return transitionClaimSnapshot(context, data);
  });

export const actOnClaimAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => claimAlertActionSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return actOnAlert(context, data);
  });

export const refreshClaimAlerts = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return refreshProjectAlerts(context, data.project_id);
  });
