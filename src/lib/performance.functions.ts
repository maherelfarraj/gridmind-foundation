// Performance & Capacity cockpit — super-admin only. Reads Postgres system
// introspection tables via the service-role client. Read-only; no mutations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";

export type CapacityStatus = "ok" | "warn" | "crit";

export type SlowQuery = {
  query: string;
  calls: number;
  meanMs: number;
  totalMs: number;
  maxMs: number;
};

export type DbHealth = {
  memoryPct: number | null;
  diskPct: number | null;
  connectionsUsed: number;
  connectionsMax: number;
  poolClients: number;
  dbSizeMb: number;
  walSizeMb: number;
  rollbackRate: number;
};

export type CapacitySignal = {
  key: "memory" | "disk" | "connections" | "wal" | "rollback_rate";
  label: string;
  value: number | null;
  unit: string;
  warnAt: number;
  critAt: number;
  status: CapacityStatus;
};

export type TableSize = {
  schema: string;
  table: string;
  totalMb: number;
};

export type PerformanceSignals = {
  windowEnd: string;
  overall: CapacityStatus;
  slowQueries: SlowQuery[];
  dbHealth: DbHealth;
  capacity: CapacitySignal[];
  tableSizes: TableSize[];
};

const THRESHOLDS = {
  memory: { warn: 75, crit: 90 },
  disk: { warn: 75, crit: 90 },
  connections: { warn: 75, crit: 90 },
  wal: { warn: 75, crit: 90 },
  rollback_rate: { warn: 2, crit: 5 },
};

const WAL_SOFT_BUDGET_MB = 2048;

function statusFor(value: number | null, warn: number, crit: number): CapacityStatus {
  if (value == null) return "ok";
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

function worst(...items: CapacityStatus[]): CapacityStatus {
  if (items.some((s) => s === "crit")) return "crit";
  if (items.some((s) => s === "warn")) return "warn";
  return "ok";
}

async function assertSuperAdmin(context: AuthContext & { user: NonNullable<AuthContext["user"]> }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    p_user_id: context.user.id,
    p_role: "super_admin",
  });
  if (error) throw error;
  if (data !== true) {
    throw Object.assign(new Error("forbidden"), {
      statusCode: 403,
      body: JSON.stringify({ error: "forbidden" }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

export const getPerformanceSignals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<PerformanceSignals> => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();

    const { data: slowRows, error: slowErr } = await supabaseAdmin.rpc("admin_get_slow_queries");
    if (slowErr) throw slowErr;

    const { data: healthRows, error: healthErr } = await supabaseAdmin.rpc("admin_get_db_health");
    if (healthErr) throw healthErr;

    const { data: tableRows, error: tableErr } = await supabaseAdmin.rpc("admin_get_table_sizes");
    if (tableErr) throw tableErr;

    const rawSlow = (slowRows ?? []) as unknown[] as Array<{
      query: string;
      calls: number;
      mean_ms: number;
      total_ms: number;
      max_ms: number;
    }>;

    const rawHealth = (healthRows ?? []) as Array<{
      connections_used: number;
      connections_max: number;
      db_size_mb: number;
      wal_size_mb: number;
      xact_commit: number;
      xact_rollback: number;
      rollback_rate: number;
    }>;

    const healthRow = rawHealth[0] ?? {
      connections_used: 0,
      connections_max: 0,
      db_size_mb: 0,
      wal_size_mb: 0,
      xact_commit: 0,
      xact_rollback: 0,
      rollback_rate: 0,
    };

    const connectionsPct =
      healthRow.connections_max > 0
        ? Math.round((healthRow.connections_used / healthRow.connections_max) * 1000) / 10
        : 0;
    const walPct = Math.round((healthRow.wal_size_mb / WAL_SOFT_BUDGET_MB) * 1000) / 10;

    const dbHealth: DbHealth = {
      memoryPct: null,
      diskPct: null,
      connectionsUsed: healthRow.connections_used,
      connectionsMax: healthRow.connections_max,
      poolClients: healthRow.connections_used,
      dbSizeMb: healthRow.db_size_mb,
      walSizeMb: healthRow.wal_size_mb,
      rollbackRate: healthRow.rollback_rate,
    };

    const capacity: CapacitySignal[] = [
      {
        key: "memory",
        label: "Memory utilization",
        value: dbHealth.memoryPct,
        unit: "%",
        warnAt: THRESHOLDS.memory.warn,
        critAt: THRESHOLDS.memory.crit,
        status: statusFor(dbHealth.memoryPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit),
      },
      {
        key: "disk",
        label: "Disk utilization",
        value: dbHealth.diskPct,
        unit: "%",
        warnAt: THRESHOLDS.disk.warn,
        critAt: THRESHOLDS.disk.crit,
        status: statusFor(dbHealth.diskPct, THRESHOLDS.disk.warn, THRESHOLDS.disk.crit),
      },
      {
        key: "connections",
        label: "Connections used",
        value: connectionsPct,
        unit: "%",
        warnAt: THRESHOLDS.connections.warn,
        critAt: THRESHOLDS.connections.crit,
        status: statusFor(connectionsPct, THRESHOLDS.connections.warn, THRESHOLDS.connections.crit),
      },
      {
        key: "wal",
        label: "WAL size (vs. soft budget)",
        value: walPct,
        unit: "%",
        warnAt: THRESHOLDS.wal.warn,
        critAt: THRESHOLDS.wal.crit,
        status: statusFor(walPct, THRESHOLDS.wal.warn, THRESHOLDS.wal.crit),
      },
      {
        key: "rollback_rate",
        label: "Transaction rollback rate",
        value: dbHealth.rollbackRate,
        unit: "%",
        warnAt: THRESHOLDS.rollback_rate.warn,
        critAt: THRESHOLDS.rollback_rate.crit,
        status: statusFor(
          dbHealth.rollbackRate,
          THRESHOLDS.rollback_rate.warn,
          THRESHOLDS.rollback_rate.crit,
        ),
      },
    ];

    return {
      windowEnd: now.toISOString(),
      overall: worst(...capacity.map((c) => c.status)),
      slowQueries: rawSlow.map((r) => ({
        query: r.query,
        calls: r.calls,
        meanMs: r.mean_ms,
        totalMs: r.total_ms,
        maxMs: r.max_ms,
      })),
      dbHealth,
      capacity,
      tableSizes: ((tableRows ?? []) as unknown[]).map((r) => ({
        schema: (r as { schema_name: string }).schema_name,
        table: (r as { table_name: string }).table_name,
        totalMb: (r as { total_mb: number }).total_mb,
      })),
    };
  });
