## P-021 — Real auth attacher middleware + requireSupabaseAuth

Replace the P-005 stub in `src/integrations/supabase/auth-attacher.ts` with a real per-request session resolver, wire it globally, and prove it end-to-end with an example RPC + unit test.

### Files touched

1. **`src/integrations/supabase/auth-attacher.ts`** — real implementation
   - `attachSupabaseAuth` = `createMiddleware({ type: 'function' })`:
     - `.client()`: unchanged — read `supabase.auth.getSession()` and attach `Authorization: Bearer <token>` header when present.
     - `.server()`: call `getRequest()`; build a per-request client via `createServerSupabaseClient(request)` from `src/integrations/supabase/server.ts` (already extracts JWT from `Authorization` header or `sb-*-auth-token` cookie). Call `supabase.auth.getUser()`. Attach `context: { user: data.user ?? null, supabase }`. Never throw here — public RPCs must work. Swallow `getUser()` errors → `user: null`. Never touch service-role key.
   - `requireSupabaseAuth(context)`: type-asserting guard. If `context.user == null`, throw an `Error` object with `statusCode: 401` and `body: JSON.stringify({ error: "unauthorized" })` plus `headers: { 'content-type': 'application/json' }` so `src/start.ts`'s status-code passthrough surfaces the JSON body. (Needs a small tweak in start.ts — see below.)
   - Export `AuthContext = { user: User | null; supabase: SupabaseClient<Database> }`.

2. **`src/start.ts`** — status-code passthrough must emit the JSON body
   - Current code re-throws statusCode errors untouched, which lets h3 render a plain text `Unauthorized`. Update the `statusCode` branch to, when the error also carries a string `body`, return a `Response(body, { status, headers })` instead of re-throwing. Keeps `/lovable/*` and `/email/unsubscribe` bypass. Keeps `attachSupabaseAuth` in `functionMiddleware`.

3. **`src/lib/user-roles.functions.ts`** (new) — example protected RPC
   ```ts
   export const getCurrentUserRoles = createServerFn({ method: 'GET' })
     .middleware([attachSupabaseAuth])
     .inputValidator(() => z.object({}).parse({}))
     .handler(async ({ context }) => {
       requireSupabaseAuth(context);
       const { data, error } = await context.supabase
         .from('user_roles')
         .select('role, company_id')
         .eq('user_id', context.user.id);
       if (error) throw error;
       return data ?? [];
     });
   ```
   Roles come only from `public.user_roles` (never profiles).

4. **`tests/unit/auth-attacher.test.ts`** (new)
   - Mock `@tanstack/react-start/server` `getRequest` and `../src/integrations/supabase/server` `createServerSupabaseClient`.
   - Case A: mocked `auth.getUser` returns `{ data: { user: null } }` → running `requireSupabaseAuth` throws with `statusCode === 401` and JSON body `{"error":"unauthorized"}`.
   - Case B: mocked returns a fake user → `context.user.id` matches and `context.supabase` is the mocked client.

### What is intentionally NOT changed

- `src/integrations/supabase/auth-middleware.ts` (auto-generated) is left untouched. This batch keeps the single canonical middleware in `auth-attacher.ts` as the task specifies.
- `src/integrations/supabase/server.ts` already handles cookie + bearer extraction and the opaque publishable-key fetch shim — reused as-is.
- No dashboard UI edits in P-021. The optional "temporary dashboard call" is a follow-up you can request after this lands.

### Verification

- `bun run test:unit` — new test passes both cases.
- Manual: call `getCurrentUserRoles` unauthenticated → HTTP 401 with `{"error":"unauthorized"}` (not the branded 500 HTML). Logged in as demo-admin → returns `company_admin` + `super_admin` rows.
- Curl `/lovable/health` and `/email/unsubscribe` still bypass the error wrapper.
- `rg SUPABASE_SERVICE_ROLE_KEY src/integrations/supabase/auth-attacher.ts` → no match.