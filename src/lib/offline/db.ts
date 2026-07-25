// P-087 — IndexedDB wrapper for the offline field queue.
// One DB, two stores: `mutations` (queued RPCs) and `photoBlobs` (raw files).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type QueueStatus = "pending" | "syncing" | "synced" | "failed";

export interface QueuedMutation {
  clientIdempotencyKey: string;
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  photoRefs?: PhotoRef[];
  status: QueueStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** Optional route/link surfaced to the UI on `duplicate_dpr`. */
  existingRoute?: string | null;
}

export interface PhotoRef {
  /** Idempotency key of the attachPhoto mutation this blob feeds. */
  blobKey: string;
  /** Storage object path (photos bucket) — must start with the company uuid. */
  objectPath: string;
}

export interface StoredPhotoBlob {
  clientIdempotencyKey: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  meta: { objectPath: string; projectId: string };
}

interface FieldDB extends DBSchema {
  mutations: {
    key: string;
    value: QueuedMutation;
    indexes: {
      by_status: QueueStatus;
      by_createdAt: number;
    };
  };
  photoBlobs: {
    key: string;
    value: StoredPhotoBlob;
  };
}

const DB_NAME = "gridmind-field";
const DB_VERSION = 1;

let cachedDb: Promise<IDBPDatabase<FieldDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<FieldDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (!cachedDb) {
    cachedDb = openDB<FieldDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("mutations")) {
          const store = db.createObjectStore("mutations", {
            keyPath: "clientIdempotencyKey",
          });
          store.createIndex("by_status", "status");
          store.createIndex("by_createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("photoBlobs")) {
          db.createObjectStore("photoBlobs", {
            keyPath: "clientIdempotencyKey",
          });
        }
      },
    });
  }
  return cachedDb;
}

/** Test-only. Closes and clears the cached connection. */
export async function __resetDbForTests() {
  if (cachedDb) {
    try {
      const db = await cachedDb;
      db.close();
    } catch {
      /* ignore */
    }
  }
  cachedDb = null;
}

export async function putMutation(m: QueuedMutation) {
  const db = await getDb();
  await db.put("mutations", m);
}

export async function patchMutation(
  key: string,
  patch: Partial<QueuedMutation>,
): Promise<QueuedMutation | null> {
  const db = await getDb();
  const tx = db.transaction("mutations", "readwrite");
  const existing = await tx.store.get(key);
  if (!existing) {
    await tx.done;
    return null;
  }
  const next: QueuedMutation = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function getMutation(key: string) {
  const db = await getDb();
  return db.get("mutations", key);
}

export async function listAllMutations(): Promise<QueuedMutation[]> {
  const db = await getDb();
  const rows = await db.getAll("mutations");
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listPendingMutations(): Promise<QueuedMutation[]> {
  const rows = await listAllMutations();
  return rows.filter((r) => r.status === "pending");
}

export async function deleteMutation(key: string) {
  const db = await getDb();
  await db.delete("mutations", key);
}

export async function countByStatus(): Promise<Record<QueueStatus, number>> {
  const rows = await listAllMutations();
  const counts: Record<QueueStatus, number> = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  };
  for (const r of rows) counts[r.status]++;
  return counts;
}

export async function putBlob(entry: StoredPhotoBlob) {
  const db = await getDb();
  await db.put("photoBlobs", entry);
}

export async function getBlob(key: string): Promise<StoredPhotoBlob | undefined> {
  const db = await getDb();
  return db.get("photoBlobs", key);
}

export async function deleteBlob(key: string) {
  const db = await getDb();
  await db.delete("photoBlobs", key);
}

export async function clearSynced(): Promise<number> {
  const rows = await listAllMutations();
  const synced = rows.filter((r) => r.status === "synced");
  await Promise.all(synced.map((r) => deleteMutation(r.clientIdempotencyKey)));
  return synced.length;
}
