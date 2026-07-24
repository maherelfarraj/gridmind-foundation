// Shared export lock check. Batch 12 ships `project_export_locks`; until
// then we treat missing table (Postgres 42P01) as "unlocked" so exports
// keep working in earlier environments.

export interface ExportLockScope {
  companyId: string;
  projectId?: string | null;
}

export async function assertExportAllowed(
  supabase: any,
  scope: ExportLockScope,
): Promise<void> {
  let query = supabase
    .from("project_export_locks")
    .select("id, reason, active")
    .eq("company_id", scope.companyId)
    .eq("active", true)
    .limit(1);

  if (scope.projectId) query = query.eq("project_id", scope.projectId);

  const { data, error } = await query;
  if (error) {
    // 42P01: table does not exist yet — graceful no-op until Batch 12.
    if (error.code === "42P01") return;
    throw error;
  }
  if (Array.isArray(data) && data.length > 0) {
    const reason = data[0]?.reason ?? "an active export lock";
    const err: any = new Error(`Export blocked: ${reason}`);
    err.statusCode = 409;
    throw err;
  }
}
