## P-004 — Branded SSR error layer

The scaffold already has `src/server.ts` (h3-swallow detection wired into `vite.config.ts` via `tanstackStart.server.entry`), `src/lib/error-capture.ts` (globalThis listeners + `consumeLastCapturedError` + `console.error` interception), and a generic `src/lib/error-page.ts`. P-004 extends these to match spec:

### 1. `src/lib/error-capture.ts`
Keep existing capture/consume/console-wrap. Add:
- `type CapturedError = { message: string; stack?: string; statusCode?: number; cause?: string; path?: string; requestId?: string }`
- `type CaptureContext = { path?: string; requestId?: string }`
- `captureError(error: unknown, context?: CaptureContext): { errorRef: string; captured: CapturedError }`
  - Normalizes `Error | string | object | unknown` into `CapturedError` (uses existing `describeError` for `cause` chain).
  - Generates short `errorRef` (8-char base36, e.g. `err_XXXXXXXX`) using `crypto.randomUUID()` sliced (Worker-safe).
  - Emits one `console.error(JSON.stringify({ level: 'error', errorRef, message, statusCode, path }))` line.
  - Returns `{ errorRef, captured }` for the caller.

### 2. `src/lib/error-page.ts`
Replace with a branded 500 document:
- Signature: `renderErrorPage(opts?: { errorRef?: string }): string`.
- Inline CSS mirroring design tokens (low-sat slate `#0f172a`/`#1e293b` dark surface OR light slate `#f8fafc` bg + `#ffffff` card + `#0f172a` fg — pick light to match default), Space Grotesk stack with system fallbacks, Inter body stack.
- Content: **GridMind EPC** wordmark (display font), heading "Something went wrong on our side.", body copy, `errorRef` shown as `Reference: <code>`, "Try again" **link** (`href="javascript:location.reload()"` → actually per spec "link"; use `<a href="/">Try again</a>` reloading via anchor? spec says "a 'Try again' link and mailto:support@gridmindepc.com" — use `<a href="">Try again</a>` (empty href reloads current URL) and `<a href="mailto:support@gridmindepc.com">Contact support</a>`).
- No stack, no env, no internal messages. Escape `errorRef` defensively.

### 3. `src/server.ts`
- Add typed `Env` interface: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `PUBLIC_HOOK_ENFORCE`, `PUBLIC_HOOK_IP_ALLOWLIST`, `PUBLIC_HOOK_SIGNING_SECRET` — all `string | undefined`.
- Add `ExecutionContext` type (Cloudflare shape: `waitUntil(promise): void; passThroughOnException(): void`).
- Type `default.fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>`.
- Replace generic `console.error(...)` in the h3-swallow branch with `const { errorRef } = captureError(consumeLastCapturedError() ?? new Error('h3 swallowed SSR error'), { path: new URL(request.url).pathname })` and return `renderErrorPage({ errorRef })`.
- Same treatment in the outer `catch (error)` block: `captureError(error, { path })` → `renderErrorPage({ errorRef })`.
- Keep lazy import and `import "./lib/error-capture"` side-effect at top.

### Verification
- `bun run build` passes.
- Sanity check: hit `/` in preview via fetch — normal 200 unchanged (no regression on success path).
- Skip end-to-end 500 trigger this turn (no route currently throws; P-004 spec doesn't require it).

### Not in scope
- Observability sinks (later batch, per spec).
- Env consumption elsewhere (only shape defined here).
