// P-085 — Discipline board server function.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  isoToday,
  isoWeekStart,
  parseQuantities,
  rollupBoard,
  type ColumnRollup,
  type DprQuantity,
  type RollupInputWbs,
} from "@/lib/discipline-board.rules";

export interface DisciplineBoardKpis {
  spi: number | null;
  cpi: number | null;
  manpowerToday: number;
  weatherHoursThisWeek: number;
}

export interface DisciplineBoardDTO {
  hasDprs: boolean;
  kpis: DisciplineBoardKpis;
  columns: ColumnRollup[];
  today: string;
  window: { from: string; to: string };
}

const input = z.object({
  projectId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getDisciplineBoard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw) => input.parse(raw))
  .handler(async ({ data, context }): Promise<DisciplineBoardDTO> => {
    requireSupabaseAuth(context);
    const { supabase } = context;
    const { projectId, from, to } = data;

    // 1. DPRs in range (submitted or approved).
    const { data: dprs, error: dprErr } = await supabase
      .from("construction_daily_reports")
      .select("id, report_date, quantities, status, total_manpower")
      .eq("project_id", projectId)
      .in("status", ["submitted", "approved"])
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date", { ascending: true });
    if (dprErr) throw dprErr;

    const rows = (dprs ?? []) as Array<{
      id: string;
      report_date: string;
      quantities: unknown;
      status: string;
      total_manpower: number;
    }>;

    // 2. Expand quantities.
    const quantities: DprQuantity[] = [];
    const wbsIds = new Set<string>();
    for (const r of rows) {
      const parsed = parseQuantities(r.quantities, r.report_date);
      for (const q of parsed) {
        quantities.push(q);
        if (q.wbs_item_id) wbsIds.add(q.wbs_item_id);
      }
    }

    // 3. Fetch WBS items referenced by these quantities.
    let wbs: RollupInputWbs[] = [];
    if (wbsIds.size > 0) {
      const { data: wbsRows, error: wbsErr } = await supabase
        .from("wbs_items")
        .select("id, name, discipline, area, uom, planned_quantity")
        .in("id", Array.from(wbsIds));
      if (wbsErr) throw wbsErr;
      wbs = (wbsRows ?? []) as RollupInputWbs[];
    }

    const today = isoToday();
    const columns = rollupBoard(quantities, wbs, { today });

    // 4. Weather hours lost this week.
    const weekStart = isoWeekStart(today);
    const { data: weatherRows, error: weatherErr } = await supabase
      .from("weather_delays")
      .select("lost_hours")
      .eq("project_id", projectId)
      .gte("delay_date", weekStart)
      .lte("delay_date", today);
    if (weatherErr) throw weatherErr;
    const weatherHoursThisWeek = (weatherRows ?? []).reduce(
      (s: number, r: any) => s + Number(r.lost_hours ?? 0),
      0,
    );

    // 5. Manpower today via today's DPRs.
    let manpowerToday = 0;
    const todaysDprIds = rows.filter((r) => r.report_date === today).map((r) => r.id);
    if (todaysDprIds.length > 0) {
      const { data: mp, error: mpErr } = await supabase
        .from("manpower_logs")
        .select("headcount, dpr_id")
        .in("dpr_id", todaysDprIds);
      if (mpErr) throw mpErr;
      manpowerToday = (mp ?? []).reduce((s: number, r: any) => s + Number(r.headcount ?? 0), 0);
    }

    // 6. Latest EVM snapshot for SPI/CPI.
    const { data: evm, error: evmErr } = await supabase
      .from("evm_snapshots")
      .select("spi, cpi, snapshot_date")
      .eq("project_id", projectId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (evmErr) throw evmErr;

    return {
      hasDprs: rows.length > 0,
      kpis: {
        spi: evm?.spi != null ? Number(evm.spi) : null,
        cpi: evm?.cpi != null ? Number(evm.cpi) : null,
        manpowerToday,
        weatherHoursThisWeek,
      },
      columns,
      today,
      window: { from, to },
    };
  });

export interface DisciplineProjectOption {
  id: string;
  name: string;
  code: string;
}

export const listDisciplineBoardProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<DisciplineProjectOption[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as DisciplineProjectOption[];
  });
