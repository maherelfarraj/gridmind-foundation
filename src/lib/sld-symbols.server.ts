// P-139 — Server-only helpers for the SLD symbol registry.
import type { SymbolPortSpec, SymbolPropertyField } from "@/lib/sld/symbol-registry";

export const SYMBOL_ADMIN_ROLES = ["engineering_admin", "company_admin"] as const;

export function symbolHttpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(ctx: any): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id as string | undefined;
  if (!companyId) symbolHttpError(403, "no_company", "Your profile is not linked to a company.");
  return companyId;
}

export async function isSymbolAdmin(ctx: any): Promise<boolean> {
  const results = await Promise.all(
    SYMBOL_ADMIN_ROLES.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as any })),
  );
  return results.some((r: any) => r.data === true);
}

export async function assertSymbolAdmin(ctx: any): Promise<void> {
  if (!(await isSymbolAdmin(ctx))) {
    symbolHttpError(403, "forbidden_role", "Only engineering admins can edit the symbol registry.");
  }
}

export function normalizePorts(ports: SymbolPortSpec[]): SymbolPortSpec[] {
  return ports.map((p) => ({
    key: p.key,
    x: Math.min(40, Math.max(0, p.x)),
    y: Math.min(40, Math.max(0, p.y)),
    ...(p.side ? { side: p.side } : {}),
  }));
}

export function normalizeSchema(schema: SymbolPropertyField[]): SymbolPropertyField[] {
  return schema.map((f) => ({ ...f, key: f.key.trim(), label: f.label.trim() }));
}

export async function symbolAudit(
  ctx: any,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await ctx.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "sld_symbol_types",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // auditing must never break registry edits
  }
}
