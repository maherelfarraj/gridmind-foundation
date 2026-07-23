## P-004 verification

### Steps
1. Create `src/routes/__test-500.tsx` — a temporary route with a loader that throws `new Error("intentional test throw")`. This forces an SSR failure so h3's swallow path triggers.
2. Run `bun run build` to regenerate routeTree and confirm the throw route is wired.
3. Verify via preview fetch:
   - `GET /__test-500` → status 500, `content-type: text/html`, body contains `GridMind EPC`, `Something went wrong on our side.`, and `Reference: err_…`. No `unhandled`/`HTTPError` JSON, no stack trace, no env values.
   - `GET /` → 200, HTML passes through unchanged.
   - `GET /abc123-nope` → 404 branded card unchanged (not overridden by the 500 wrapper).
4. Confirm structured log line was emitted (`{"level":"error","errorRef":"err_…",...}`) via server-function-logs.
5. Delete `src/routes/__test-500.tsx` and rebuild to confirm the test route is gone.

### Not in scope
- No changes to `error-capture.ts`, `error-page.ts`, or `server.ts` — those already meet spec from build turn.
