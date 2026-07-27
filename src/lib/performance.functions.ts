// Performance & Capacity cockpit — super-admin only. Reads Postgres
// introspection RPCs (admin_get_slow_queries / admin_get_db_health /
// admin_get_table_sizes) via the service-role client. Read-only; no mutations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

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
  wal: { warn: 75, crit: 90 }, // wal % of an assumed soft budget (see below)
  rollback_rate: { warn: 2, crit: 5 }, // percent of transactions rolled back
};

const WAL_SOFT_BUDGET_MB = 2048; // heuristic budget for a single-node Postgres

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

type SlowQueryRow = {
  query: string;
  calls: number;
  mean_ms: number;
  total_ms: number;
  max_ms: number;
};

type DbHealthRow = {
  connections_used: number;
  connections_max: number;
  db_size_mb: number;
  wal_size_mb: number;
  xact_commit: number;
  xact_rollback: number;
  rollback_rate: number;
};

type TableSizeRow = {
  schema_name: string;
  table_name: string;
  total_bytes: number;
  total_mb: number;
};

export const getPerformanceSignals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<PerformanceSignals> => {
    requireSupabaseAuth(context);

    const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
      p_user_id: context.user.id,
      p_role: "super_admin",
    });
    if (roleErr) throw roleErr;
    if (isSuper !== true) {
      throw Object.assign(new Error("forbidden"), {
        statusCode: 403,
        body: JSON.stringify({ error: "forbidden" }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Cross-tenant, system-level introspection requires the service-role
    // client. Load it inside the handler only.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const admin = supabaseAdmin as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    const [slowRes, healthRes, tableRes] = await Promise.all([
      admin.rpc("admin_get_slow_queries"),
      admin.rpc("admin_get_db_health"),
      admin.rpc("admin_get_table_sizes"),
    ]);

    if (slowRes.error) throw slowRes.error;
    if (healthRes.error) throw healthRes.error;
    if (tableRes.error) throw tableRes.error;

    const slowRows = (slowRes.data ?? []) as SlowQueryRow[];
    const healthRows = (healthRes.data ?? []) as DbHealthRow[];
    const tableRows = (tableRes.data ?? []) as TableSizeRow[];

    const healthRow = healthRows[0] ?? {
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

    // Memory/disk aren't exposed by managed Postgres over SQL — surface as
    // "unknown" (null) rather than fabricate a number.
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
      windowEnd: new Date().toISOString(),
      overall: worst(...capacity.map((c) => c.status)),
      slowQueries: slowRows.map((r) => ({
        query: r.query,
        calls: r.calls,
        meanMs: r.mean_ms,
        totalMs: r.total_ms,
        maxMs: r.max_ms,
      })),
      dbHealth,
      capacity,
      tableSizes: tableRows.map((r) => ({
        schema: r.schema_name,
        table: r.table_name,
        totalMb: r.total_mb,
      })),
    };
  });
