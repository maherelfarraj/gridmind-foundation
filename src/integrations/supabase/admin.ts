/**
 * P-121 — Service-role admin client for public-hook guard.
 *
 * Thin re-export of the per-request service-role client. NEVER import this
 * from client bundles or use it before the caller is verified via
 * `guardPublicHook`. Bypasses RLS.
 */
import { createServiceRoleClient } from "./server";

export const admin = () => createServiceRoleClient();
export { createServiceRoleClient };
