
## P-005 — start.ts middleware chain

### 1. `src/start.ts` — path exclusions + doc comment

Update the existing `errorMiddleware` (request middleware) to:

- Compute `pathname` from `request.url` once at the top.
- If `pathname.startsWith("/lovable/")` OR `pathname === "/email/unsubscribe"`, `return next()` directly — no try/catch, no wrapping, no branding.
- Otherwise: keep the current try/catch. Re-throw rule stays as it is today — if the caught error has a **numeric** `statusCode` property (`typeof err.statusCode === "number"`), re-throw untouched so h3 serves the intended status (401/404/429 …). Tighten the current check (which only tests `"statusCode" in error`) to the numeric variant so non-numeric values fall through to branding.
- All other errors → `captureError(error, { path })` → return branded HTML 500 via `renderErrorPage({ errorRef })` with `content-type: text/html; charset=utf-8`.

Prepend a comment block documenting the chain and ordering:

```
// Global middleware chain (outer → inner):
//   requestMiddleware:  [errorMiddleware]      — wraps every SSR/route/serverFn request
//   functionMiddleware: [attachSupabaseAuth]   — runs per createServerFn RPC
//
// errorMiddleware rules:
//   • Bypass entirely for paths starting with "/lovable/" and the exact
//     path "/email/unsubscribe" (Lovable preview iframe + unsubscribe links).
//   • Re-throw untouched when the caught error has a numeric `statusCode`
//     (preserves 401/404/429/... intended by TanStack/h3).
//   • Everything else → captureError() + branded HTML 500 via renderErrorPage().
```

Keep the `createStart(() => ({ functionMiddleware: [attachSupabaseAuth], requestMiddleware: [errorMiddleware] }))` export as-is.

### 2. `src/integrations/supabase/auth-attacher.ts` — hybrid extension

Per your choice, extend the existing auto-generated file rather than replace it. Preserve the working `.client()` bearer-token attach, and add:

- A typed context shape at module scope:
  ```ts
  import type { SupabaseClient, User } from "@supabase/supabase-js";
  export type AuthContext = { user: User | null; supabase: SupabaseClient | null };
  ```
- A `.server()` step on the same middleware chain that attaches `{ user: null, supabase: null }` via `next({ context: { user: null, supabase: null } })`. Real session wiring lands later; the stub only proves the context shape flows through.
- `export function requireSupabaseAuth(context: AuthContext): asserts context is AuthContext & { user: User }` — throws `Object.assign(new Error("Unauthorized"), { statusCode: 401 })` when `context.user == null`. This is what proves the numeric-`statusCode` passthrough in start.ts.

Export names stay: `attachSupabaseAuth`, `requireSupabaseAuth`. Note: this file carries the "auto-generated" banner. Editing it is a deliberate deviation you've approved for this batch; a future regeneration by the Cloud integration could overwrite the additions and would need re-applying.

### 3. No other files touched

`error-capture.ts`, `error-page.ts`, `server.ts`, routes, and Cloud integration files remain unchanged.

### Acceptance signals

- `bun run build` succeeds.
- SSR of `/` still returns 200 with no hydration errors.
- Any thrown error with `{ statusCode: 401 }` inside a request pipeline surfaces as an actual 401 (not branded HTML). Verified by a temporary probe route that throws the same object `requireSupabaseAuth` produces, then removed.
- A route under `/lovable/anything` that throws is NOT converted to the branded 500 page (bypassed).
- A generic thrown Error still produces the branded 500 HTML with an `err_…` reference.
