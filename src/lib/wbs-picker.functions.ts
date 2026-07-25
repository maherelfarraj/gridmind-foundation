// P-086 — Lightweight WBS picker (name/code/area/discipline/uom) for DPR forms.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

export interface WbsPickerRow {
  id: string;
  code: string | null;
  name: string;
  discipline: string | null;
  area: string | null;
  uom: string | null;
  planned_quantity: number | null;
}

const input = z.object({
  projectId: z.string().uuid(),
  q: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const listWbsForPicker = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<WbsPickerRow[]> => {
    requireSupabaseAuth(context);
    let query = context.supabase
      .from("wbs_items")
      .select("id, code, name, discipline, area, uom, planned_quantity")
      .eq("project_id", data.projectId)
      .order("code", { ascending: true })
      .limit(data.limit ?? 100);
    if (data.q && data.q.length > 0) {
      const like = `%${data.q.replace(/[%_]/g, "")}%`;
      query = query.or(`name.ilike.${like},code.ilike.${like},area.ilike.${like}`);
    }
    const { data: rows, error } = await query;
    if (error) throw error;
    return (rows ?? []) as unknown as WbsPickerRow[];
  });
