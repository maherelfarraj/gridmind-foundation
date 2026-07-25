// P-087 — Server-side idempotency mirror.
// Ensures a repeated createServerFn call with the same client_idempotency_key
// short-circuits after the first success, so retries from the offline queue
// produce zero duplicate rows.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export interface MirrorArgs {
  key?: string | null;
  entity: string;
  action: string;
  companyId: string;
  projectId?: string | null;
  input?: unknown;
}

/**
 * Wraps a mutation so it becomes idempotent for a given
 * (auth.uid(), client_idempotency_key) tuple.
 *
 * - If a synced mirror row already exists for the key, returns the cached
 *   result without invoking `doWork()`.
 * - Otherwise upserts a `pending` mirror row, runs `doWork()`, then marks the
 *   mirror `synced` (or `failed`) and writes an audit log entry.
 */
export async function withIdempotency<T>(
  context: AuthContext,
  args: MirrorArgs,
  doWork: () => Promise<T>,
): Promise<T> {
  if (!args.key) return doWork();

  const userId = context.user!.id;
  const supabase = context.supabase;

  // Look up any existing mirror row for this key + user.
  const { data: existing, error: exErr } = await supabase
    .from("offline_queue")
    .select("id, status, payload")
    .eq("user_id", userId)
    .eq("client_idempotency_key", args.key)
    .maybeSingle();
  if (exErr) throw exErr;

  if (existing && (existing as any).status === "synced") {
    const cached = (existing as any).payload?.result;
    if (cached !== undefined) return cached as T;
  }

  // Upsert pending mirror.
  let mirrorId: string;
  if (existing) {
    mirrorId = (existing as any).id;
    const { error } = await supabase
      .from("offline_queue")
      .update({ status: "pending", error: null } as any)
      .eq("id", mirrorId);
    if (error) throw error;
  } else {
    const { data: ins, error } = await supabase
      .from("offline_queue")
      .insert({
        company_id: args.companyId,
        project_id: args.projectId ?? null,
        user_id: userId,
        client_idempotency_key: args.key,
        entity: args.entity,
        action: args.action,
        payload: { input: args.input ?? null },
        status: "pending",
      } as any)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    mirrorId = (ins as any).id;
  }

  try {
    const result = await doWork();
    await supabase
      .from("offline_queue")
      .update({
        status: "synced",
        synced_at: new Date().toISOString(),
        payload: { input: args.input ?? null, result },
        error: null,
      } as any)
      .eq("id", mirrorId);
    try {
      await supabase.rpc("write_audit_log", {
        p_action: "offline.sync",
        p_entity: "offline_queue",
        p_entity_id: mirrorId,
        p_metadata: {
          entity: args.entity,
          action: args.action,
        } as any,
      });
    } catch {
      /* best-effort audit */
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase
        .from("offline_queue")
        .update({ status: "failed", error: message.slice(0, 500) } as any)
        .eq("id", mirrorId);
    } catch {
      /* swallow */
    }
    throw err;
  }
}
