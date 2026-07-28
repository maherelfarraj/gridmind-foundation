// External-viewer shell routing: portal users never land in the internal AppShell.
import { supabase } from "@/integrations/supabase/client";

export const EXTERNAL_ONLY_ROLES = new Set([
  "vendor_viewer",
  "client_viewer",
  "investor_viewer",
  "lender_viewer",
  "external_viewer",
]);

/** Mirrors public.is_external_viewer() — true when the user has ONLY external roles. */
export function isExternalOnly(roleNames: readonly string[]): boolean {
  return roleNames.length > 0 && roleNames.every((r) => EXTERNAL_ONLY_ROLES.has(r));
}

/** "/vendor" for vendor portal users, "/portal" for other external viewers, null for internal. */
export function externalLandingFor(roleNames: readonly string[]): "/vendor" | "/portal" | null {
  if (!isExternalOnly(roleNames)) return null;
  return roleNames.includes("vendor_viewer") ? "/vendor" : "/portal";
}

/** Resolves the post-auth landing route for the signed-in user. */
export async function resolveLandingRoute(fallback = "/dashboard"): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return fallback;
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roleNames = (roles ?? []).map((r) => r.role as string);
  return externalLandingFor(roleNames) ?? fallback;
}
