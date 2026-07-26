// P-139 — SLD symbol registry server functions (thin wrapper: declarations only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertSymbolAdmin,
  currentCompanyId,
  isSymbolAdmin,
  normalizePorts,
  normalizeSchema,
  symbolAudit,
  symbolHttpError,
} from "@/lib/sld-symbols.server";
import { SYMBOL_CATEGORIES, type SymbolTypeRecord } from "@/lib/sld/symbol-registry";

const SELECT_COLS =
  "id, company_id, type_key, display_name, category, svg_body, ports, property_schema, default_properties, tag_prefix, sort_order";

export type SymbolRegistryPayload = {
  symbols: SymbolTypeRecord[];
  canManage: boolean;
  companyId: string;
};

export const listSymbolTypes = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<SymbolRegistryPayload> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const [{ data, error }, canManage] = await Promise.all([
      context.supabase
        .from("sld_symbol_types")
        .select(SELECT_COLS)
        .order("sort_order", { ascending: true }),
      isSymbolAdmin(context),
    ]);
    if (error) throw error;
    return {
      symbols: ((data ?? []) as any[]).map((r) => ({
        ...r,
        ports: (r.ports ?? []) as SymbolTypeRecord["ports"],
        property_schema: (r.property_schema ?? []) as SymbolTypeRecord["property_schema"],
        default_properties: (r.default_properties ?? {}) as Record<string, unknown>,
      })) as SymbolTypeRecord[],
      canManage,
      companyId,
    };
  });

const portSchema = z.object({
  key: z.string().trim().min(1).max(40),
  x: z.number().finite(),
  y: z.number().finite(),
  side: z.enum(["left", "right", "top", "bottom"]).optional(),
});

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["number", "text", "select", "bool"]),
  unit: z.string().trim().max(20).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  required: z.boolean().optional(),
});

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  type_key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only."),
  display_name: z.string().trim().min(2).max(120),
  category: z.enum(SYMBOL_CATEGORIES),
  svg_body: z.string().trim().min(1).max(20000),
  ports: z.array(portSchema).max(24).default([]),
  property_schema: z.array(fieldSchema).max(40).default([]),
  default_properties: z.record(z.string(), z.unknown()).default({}),
  tag_prefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/, "Tag prefix must be uppercase letters or digits."),
  sort_order: z.number().int().min(0).max(9999).default(500),
});

export const upsertSymbolType = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertSymbolAdmin(context);
    const companyId = await currentCompanyId(context);

    if (/<\s*script/i.test(data.svg_body)) {
      symbolHttpError(400, "unsafe_svg", "Symbol markup cannot contain scripts.");
    }

    const row = {
      company_id: companyId,
      type_key: data.type_key,
      display_name: data.display_name,
      category: data.category,
      svg_body: data.svg_body,
      ports: normalizePorts(data.ports) as any,
      property_schema: normalizeSchema(data.property_schema) as any,
      default_properties: data.default_properties as any,
      tag_prefix: data.tag_prefix,
      sort_order: data.sort_order,
    };

    const { data: saved, error } = await context.supabase
      .from("sld_symbol_types")
      .upsert(row as any, { onConflict: "company_id,type_key" })
      .select(SELECT_COLS)
      .single();
    if (error) throw error;

    await symbolAudit(context, "sld.symbol_type_saved", (saved as any).id, {
      type_key: data.type_key,
      category: data.category,
    });
    return saved as unknown as SymbolTypeRecord;
  });

export const deleteSymbolType = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertSymbolAdmin(context);

    const { data: existing, error: readErr } = await context.supabase
      .from("sld_symbol_types")
      .select("id, company_id, type_key")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing) symbolHttpError(404, "symbol_not_found", "Symbol override not found.");
    if (!(existing as any).company_id) {
      symbolHttpError(403, "global_symbol", "Global library symbols cannot be removed.");
    }

    const { error } = await context.supabase
      .from("sld_symbol_types")
      .delete()
      .eq("id", data.id)
      .not("company_id", "is", null);
    if (error) symbolHttpError(403, "delete_blocked", error.message);

    await symbolAudit(context, "sld.symbol_type_removed", data.id, {
      type_key: (existing as any).type_key,
    });
    return { ok: true as const };
  });
