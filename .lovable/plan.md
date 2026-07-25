## P-087 — Offline queue (IndexedDB + Background Sync)

Make the field flow (DPR, observations, photos) offline-first: buffer mutations in IndexedDB, upload photo blobs then their parent rows once online, dedupe by client idempotency key server-side, and surface a queue UI. Auth-only, RLS-scoped — no service-role usage.

### Package + client store

- `bun add idb`.
- `src/lib/offline/db.ts` — thin `idb` wrapper opening DB `gridmind-field` v1 with stores:
  - `mutations` (keyPath `clientIdempotencyKey`) — `{ clientIdempotencyKey, entity, action, payload, photoRefs, status: 'pending'|'syncing'|'synced'|'failed', attempts, error, createdAt, updatedAt }`. Indexes: `by_status`, `by_createdAt`.
  - `photoBlobs` (keyPath `clientIdempotencyKey`) — `{ clientIdempotencyKey, blob, fileName, mimeType, meta }`.
  - Typed helpers: `putMutation`, `patchMutation`, `listPending`, `listAll`, `deleteMutation`, `putBlob`, `getBlob`, `deleteBlob`, `clearSynced`.

### Queue engine

- `src/lib/offline/queue.ts`:
  - `enqueueMutation({ entity, action, payload, photoRefs? })` — generates `crypto.randomUUID()` key, writes to `mutations` store, notifies subscribers, returns key immediately.
  - `enqueuePhotoBlob(key, blob, fileName, mimeType, meta)` — parallel write to `photoBlobs`.
  - `syncQueue()` — oldest-first over `pending`, marks `syncing`, per entry:
    1. If `photoRefs` present, upload each blob to `photos` bucket via `supabase.storage` at the path from `meta.objectPath` (client-side, authed user, RLS enforced).
    2. Dispatch to the target server fn (routed via `entity+action` map — imports `upsertDprHeader`, `addManpowerRow`, `addWeatherDelay`, `addQuantityRow`, `attachPhoto`, `createObservation`, `submitDpr`) passing `clientIdempotencyKey` alongside the original payload.
    3. On success: mark `synced`, delete matching blob, bump `attempts`. On network / 5xx / offline: revert to `pending`, keep blob, `attempts++`. On 4xx / Zod: mark `failed` with server message; if `duplicate_dpr` unique-violation include `existingRoute` in the payload for the toast link.
  - `subscribe(cb)` returns unsubscribe; counts helper `getCounts()` → `{pending, failed}`.
- `src/lib/offline/dispatch.ts` — map of `entity.action` → server fn wrapper accepting `{ ...payload, clientIdempotencyKey }`.

### Sync triggers

- `src/lib/offline/triggers.ts`:
  - `window.addEventListener('online', syncQueue)`.
  - `setInterval(syncQueue, 60_000)` while tab visible; pauses on `visibilitychange` hidden.
  - Best-effort `navigator.serviceWorker.ready.then(sw => sw.sync.register('gridmind-field-sync'))` — guarded feature detect; graceful no-op when unsupported (iOS Safari). No new SW file is required for the fallback path; the online/interval triggers cover behavior.
- Wired once from `src/routes/__root.tsx` inside a `useEffect` (client-only).

### Server-side idempotency

- Extend `src/lib/dpr.rules.ts` schemas (`dprHeaderInput`, `manpowerRowInput`, `weatherDelayInput`, `quantityRowInput`, `attachPhotoInput`, `observationInput`, `submitDprInput`) with `clientIdempotencyKey: z.string().uuid().optional()`.
- Add `src/lib/offline-mirror.ts` helper `recordMirror(context, { key, entity, action, projectId, payload, resultId? })`:
  - When `key` provided, `select id, status, payload -> 'result' from offline_queue where user_id = auth.uid() and client_idempotency_key = key`.
  - If `status = 'synced'`, return `{ hit: true, cached }` — server fn returns cached result without re-applying.
  - Else `upsert (company_id, user_id, client_idempotency_key)` with `status='pending'`, then after primary write update to `status='synced', synced_at=now(), payload = jsonb_build_object('input', payload, 'result', row)`, call `write_audit_log('offline.sync','offline_queue', id, { entity, action })`.
- Update each DPR/observation/photo `createServerFn` in `src/lib/dpr.functions.ts` to check the cache before work and record after. Cached hits short-circuit before any DB writes so retries produce zero duplicate rows.
- Zero migration: reuses existing `offline_queue` table + `unique(company_id, user_id, client_idempotency_key)`. No new grants.

### UI

- `src/components/offline/offline-badge.tsx` — `wifi-off` icon when `navigator.onLine === false`; button chip beside it shows `pending` + `failed` counts (semantic tokens `warning` / `destructive`). Subscribed to queue store via a tiny `useOfflineQueue()` hook in `src/hooks/use-offline-queue.ts`.
- Mount inside the authenticated AppShell header.
- Route `src/routes/_authenticated/field.sync-status.tsx`:
  - Reads local queue via `useOfflineQueue()`; groups by status; skeleton, empty state ("All caught up — nothing to sync"), error state, retry / discard actions per entry.
  - Nav entry "Sync status" in `src/lib/nav-map.ts` under Field.
- On any `duplicate_dpr` failure, `sonner` toast with a `Link` to the existing DPR (from `existingRoute` in entry payload).

### Tests

- `tests/unit/offline-queue.test.ts` — uses `fake-indexeddb/auto` (already needed for idb tests; add via `bun add -d fake-indexeddb`). Cases:
  - enqueue writes with generated uuid key + `pending` status.
  - `syncQueue` marks entries `synced` on success (stubbed dispatcher).
  - Network failure keeps entry `pending`, increments `attempts`, retains blob.
  - 4xx marks `failed` with message.
  - Same key run twice hits dispatcher once (dedupe via mock server response echoing cached hit).

### File map

Create: `src/lib/offline/db.ts`, `src/lib/offline/queue.ts`, `src/lib/offline/dispatch.ts`, `src/lib/offline/triggers.ts`, `src/lib/offline-mirror.ts`, `src/hooks/use-offline-queue.ts`, `src/components/offline/offline-badge.tsx`, `src/routes/_authenticated/field.sync-status.tsx`, `tests/unit/offline-queue.test.ts`.
Edit: `src/lib/dpr.rules.ts`, `src/lib/dpr.functions.ts`, `src/routes/__root.tsx`, `src/lib/nav-map.ts`, authenticated shell header component, `package.json` (idb + fake-indexeddb).

### Notes / decisions

- Photos upload from client (authed user, RLS) — no server-role. `photoObjectPath` from P-086 continues to produce the `{company_uuid}/…` path required by storage policy.
- The mirror table is written under the caller's identity via `context.supabase` — RLS on `offline_queue` already scopes reads/writes per user.
- Background Sync unsupported (Safari): online + interval + on-focus resync cover the gap; documented in `docs/` alongside the field module notes.
