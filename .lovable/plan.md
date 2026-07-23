
## P-005 verification — temporary probe routes

Add two temporary server routes (raw HTTP, easier to hit than serverFn RPCs), verify, remove.

### 1. Add probes

`src/routes/api/__probe.401.ts`:
```ts
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/__probe/401")({
  server: { handlers: { GET: async () => {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  } } },
});
```

`src/routes/api/__probe.boom.ts`:
```ts
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/__probe/boom")({
  server: { handlers: { GET: async () => { throw new Error("boom"); } } },
});
```

`src/routes/lovable/__probe.boom.ts` (verifies `/lovable/*` bypass — a thrown Error here must NOT become the branded 500; it should surface as h3's default 500 JSON, proving the wrapper was skipped):
```ts
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/lovable/__probe/boom")({
  server: { handlers: { GET: async () => { throw new Error("bypass"); } } },
});
```

### 2. Verify

- `curl -i /api/__probe/401` → status **401**, no branded HTML.
- `curl -i /api/__probe/boom` → status **500**, `content-type: text/html`, body contains `err_` reference and "GridMind EPC".
- `curl -i /lovable/__probe/boom` → status **500** but **not** the branded HTML body (h3 default JSON / plain response), proving bypass.
- Grep confirm: `requireSupabaseAuth` exported from `src/integrations/supabase/auth-attacher.ts` and `AuthContext = { user, supabase }`.
- Grep confirm: `src/start.ts` has `requestMiddleware: [errorMiddleware]` and `functionMiddleware: [attachSupabaseAuth]`.

### 3. Cleanup

Delete all three probe route files. Confirm build still passes.

No other files touched.
