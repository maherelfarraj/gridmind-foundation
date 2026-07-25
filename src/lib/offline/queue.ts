// P-087 — Offline queue engine.
//
// Buffers server-function mutations in IndexedDB, uploads any linked photo
// blobs, then dispatches to the target server fn passing the stored
// `clientIdempotencyKey` so retries dedupe server-side.
import {
  countByStatus,
  deleteBlob,
  deleteMutation,
  getBlob,
  getMutation,
  listPendingMutations,
  patchMutation,
  putBlob,
  putMutation,
  type PhotoRef,
  type QueuedMutation,
  type StoredPhotoBlob,
} from "@/lib/offline/db";
import { getDispatcher } from "@/lib/offline/dispatch";
import { supabase } from "@/integrations/supabase/client";

export type QueueEvent =
  | { type: "enqueued"; key: string }
  | { type: "synced"; key: string }
  | { type: "failed"; key: string; error: string; existingRoute?: string | null }
  | { type: "pending"; key: string; error: string }
  | { type: "discarded"; key: string };

const listeners = new Set<(e: QueueEvent) => void>();

export function subscribe(cb: (e: QueueEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(e: QueueEvent) {
  for (const cb of listeners) {
    try {
      cb(e);
    } catch {
      /* swallow */
    }
  }
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Enqueue a mutation. Returns the generated idempotency key. */
export async function enqueueMutation(args: {
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  photoRefs?: PhotoRef[];
  /** Override the generated key (used when the caller pre-allocated it). */
  clientIdempotencyKey?: string;
}): Promise<string> {
  const key = args.clientIdempotencyKey ?? newUuid();
  const now = Date.now();
  const row: QueuedMutation = {
    clientIdempotencyKey: key,
    entity: args.entity,
    action: args.action,
    payload: { ...args.payload, clientIdempotencyKey: key },
    photoRefs: args.photoRefs,
    status: "pending",
    attempts: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await putMutation(row);
  notify({ type: "enqueued", key });
  return key;
}

/** Store a photo blob keyed by the attachPhoto mutation's idempotency key. */
export async function enqueuePhotoBlob(entry: StoredPhotoBlob) {
  await putBlob(entry);
}

// Simple classifier: which errors mean "leave pending and try again later" vs
// "permanent client error, mark failed".
function classifyError(err: unknown): {
  transient: boolean;
  message: string;
  code?: string;
  existingRoute?: string | null;
} {
  if (!err) return { transient: false, message: "Unknown error" };
  const anyErr = err as any;

  // Fetch/network layer — always retry.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { transient: true, message: "offline" };
  }
  if (anyErr instanceof TypeError && /fetch|network/i.test(anyErr.message)) {
    return { transient: true, message: anyErr.message };
  }

  // HTTP-shaped errors from createServerFn.
  const status: number | undefined =
    typeof anyErr.status === "number"
      ? anyErr.status
      : typeof anyErr.statusCode === "number"
        ? anyErr.statusCode
        : undefined;

  let code: string | undefined;
  let existingRoute: string | null | undefined;
  const bodyRaw = anyErr.body ?? anyErr.responseText;
  if (typeof bodyRaw === "string") {
    try {
      const parsed = JSON.parse(bodyRaw);
      code = parsed?.error;
      existingRoute = parsed?.existingRoute ?? null;
    } catch {
      /* not json */
    }
  }

  const message =
    (typeof anyErr.message === "string" && anyErr.message) ||
    (typeof bodyRaw === "string" ? bodyRaw : String(err));

  if (status && status >= 500) {
    return { transient: true, message, code };
  }
  return { transient: false, message, code, existingRoute };
}

async function uploadPhotos(mutation: QueuedMutation): Promise<void> {
  if (!mutation.photoRefs?.length) return;
  for (const ref of mutation.photoRefs) {
    const blob = await getBlob(ref.blobKey);
    if (!blob) continue; // already uploaded on a previous attempt
    const { error } = await supabase.storage.from("photos").upload(ref.objectPath, blob.blob, {
      contentType: blob.mimeType,
      upsert: true,
    });
    if (error) {
      // Storage "already exists" is a benign retry — treat as success.
      const msg = error.message ?? "";
      if (!/already exists|duplicate/i.test(msg)) {
        throw Object.assign(new Error(msg || "photo upload failed"), {
          status: 502,
        });
      }
    }
    // Successful upload: drop the local blob to reclaim quota.
    await deleteBlob(ref.blobKey);
  }
}

let syncing = false;

/**
 * Drain pending mutations oldest-first. Uploads photo blobs before their
 * parent RPC. Safe to call concurrently — a single in-flight sync is enforced.
 */
export async function syncQueue(): Promise<{
  attempted: number;
  synced: number;
  failed: number;
}> {
  if (syncing) return { attempted: 0, synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  let attempted = 0;
  try {
    const pending = await listPendingMutations();
    for (const m of pending) {
      attempted++;
      await patchMutation(m.clientIdempotencyKey, { status: "syncing" });
      const dispatcher = getDispatcher(m.entity, m.action);
      if (!dispatcher) {
        await patchMutation(m.clientIdempotencyKey, {
          status: "failed",
          error: `no dispatcher for ${m.entity}.${m.action}`,
        });
        failed++;
        notify({
          type: "failed",
          key: m.clientIdempotencyKey,
          error: `no dispatcher for ${m.entity}.${m.action}`,
        });
        continue;
      }
      try {
        await uploadPhotos(m);
        await dispatcher(m.payload);
        await patchMutation(m.clientIdempotencyKey, {
          status: "synced",
          error: null,
          attempts: m.attempts + 1,
        });
        synced++;
        notify({ type: "synced", key: m.clientIdempotencyKey });
      } catch (err) {
        const info = classifyError(err);
        if (info.transient) {
          await patchMutation(m.clientIdempotencyKey, {
            status: "pending",
            error: info.message,
            attempts: m.attempts + 1,
          });
          notify({
            type: "pending",
            key: m.clientIdempotencyKey,
            error: info.message,
          });
        } else {
          await patchMutation(m.clientIdempotencyKey, {
            status: "failed",
            error: info.message,
            attempts: m.attempts + 1,
            existingRoute: info.existingRoute ?? null,
          });
          failed++;
          notify({
            type: "failed",
            key: m.clientIdempotencyKey,
            error: info.message,
            existingRoute: info.existingRoute ?? null,
          });
        }
      }
    }
    return { attempted, synced, failed };
  } finally {
    syncing = false;
  }
}

/** Explicitly retry a single mutation regardless of current status. */
export async function retryMutation(key: string): Promise<void> {
  const m = await getMutation(key);
  if (!m) return;
  await patchMutation(key, { status: "pending", error: null });
  notify({ type: "pending", key, error: "queued for retry" });
  await syncQueue();
}

/** Drop a mutation from the queue. */
export async function discardMutation(key: string): Promise<void> {
  await deleteMutation(key);
  try {
    await deleteBlob(key);
  } catch {
    /* fine */
  }
  notify({ type: "discarded", key });
}

export async function getCounts() {
  return countByStatus();
}
