// P-082 — Shared server-side helpers for project finance modules.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const r = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as any })),
  );
  return r.some((x) => Boolean(x?.data));
}

export async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (ctx as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as any)?.company_id as string | undefined;
  if (!id) httpError(400, "no_company");
  return id!;
}

export async function writeAudit(
  ctx: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown>,
) {
  await ctx.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId as any,
    p_metadata: meta as any,
  });
}

export function projectFinanceErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return String(p.message);
      if (p?.error) return String(p.error);
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}
