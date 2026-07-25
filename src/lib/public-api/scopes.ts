// P-124 — Canonical API key scope catalog.
//
// Single source of truth used by:
//   - the /settings/api-keys admin UI (checkbox list + validation),
//   - createApiKey / rotateApiKey server fns (allow-list validation),
//   - /api/public/hooks/* routes when passing `scope` to guardPublicHook.
//
// Add a scope here BEFORE wiring it into a new hook route, so the admin UI
// can grant it and the create-key validator accepts it. Never accept an
// arbitrary scope string from the client.
export const API_KEY_SCOPES = [
  "scada:telemetry:write",
  "hooks:events",
  "hooks:scada",
  "read:reports",
  "webhooks:manage",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(v: string): v is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(v);
}
