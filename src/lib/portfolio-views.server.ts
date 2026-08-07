// GC-09 — Portfolio saved views: per-user CRUD with owner-only mutation.
//
// RLS is the real boundary (owner-only writes, finance-only sharing); these
// helpers add friendly errors, config validation and the audit trail entries.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasCloseRole } from "@/lib/costing.close.server";
import { costingAudit, costingHttpError } from "@/lib/costing.server";
import { currentCompanyId } from "@/lib/portfolio-costing.server";
import {
  parseSavedViewConfig,
  SAVED_VIEW_CONFIG_VERSION,
  type SavedView,
  type SavedViewCreateInput,
  type SavedViewUpdateInput,
} from "@/lib/portfolio-views.rules";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

const TABLE = "portfolio_saved_views";
const COLS =
  "id, company_id, owner_id, name, description, config, config_version, is_shared, is_default, created_at, updated_at";

interface RawView {
  id: string;
  company_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  config: unknown;
  config_version: number;
  is_shared: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function userId(ctx: AuthContext): string {
  const id = ctx.user?.id ?? null;
  if (!id) costingHttpError(401, "unauthorized", "Sign in to manage saved views.");
  return id as string;
}

function toView(raw: RawView, uid: string, ownerName: string | null): SavedView {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    config: parseSavedViewConfig(raw.config),
    config_version: raw.config_version,
    is_shared: raw.is_shared,
    is_default: raw.is_default,
    owner_id: raw.owner_id,
    owner_name: ownerName,
    is_owner: raw.owner_id === uid,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export async function listSavedViews(ctx: AuthContext): Promise<SavedView[]> {
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const [{ data, error }, profilesRes] = await Promise.all([
    sbOf(ctx)
      .from(TABLE)
      .select(COLS)
      .eq("company_id", companyId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    sbOf(ctx).from("profiles").select("id, full_name").eq("company_id", companyId),
  ]);
  if (error) {
    // The table is optional in older environments; an absent relation is empty.
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  const nameById = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name ?? null,
    ]),
  );
  return ((data ?? []) as RawView[]).map((r) => toView(r, uid, nameById.get(r.owner_id) ?? null));
}

async function requireSharePermission(ctx: AuthContext, isShared: boolean): Promise<void> {
  if (!isShared) return;
  if (!(await hasCloseRole(ctx))) {
    costingHttpError(
      403,
      "share_forbidden",
      "Only finance admins and company admins may share a portfolio view.",
    );
  }
}

async function loadOwn(ctx: AuthContext, id: string, uid: string): Promise<RawView> {
  const { data, error } = await sbOf(ctx).from(TABLE).select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  const row = (data ?? null) as RawView | null;
  if (!row) costingHttpError(404, "view_not_found", "Saved view not found.");
  if (row!.owner_id !== uid) {
    costingHttpError(403, "not_view_owner", "Only the owner can change this view.");
  }
  return row!;
}

export async function createSavedView(
  ctx: AuthContext,
  input: SavedViewCreateInput,
): Promise<SavedView> {
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  await requireSharePermission(ctx, input.is_shared);

  const { data, error } = await sbOf(ctx)
    .from(TABLE)
    .insert({
      company_id: companyId,
      owner_id: uid,
      name: input.name,
      description: input.description,
      config: input.config,
      config_version: SAVED_VIEW_CONFIG_VERSION,
      is_shared: input.is_shared,
      is_default: input.is_default,
    })
    .select(COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      costingHttpError(409, "view_name_taken", "You already have a view with that name.");
    }
    throw error;
  }
  const row = data as RawView;
  await costingAudit(ctx, "costing.portfolio.view_saved", TABLE, row.id, {
    company_id: companyId,
    view_id: row.id,
    view_name: row.name,
    is_shared: row.is_shared,
    is_default: row.is_default,
  });
  return toView(row, uid, null);
}

export async function updateSavedView(
  ctx: AuthContext,
  input: SavedViewUpdateInput,
): Promise<SavedView> {
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const before = await loadOwn(ctx, input.id, uid);
  if (input.is_shared !== undefined) await requireSharePermission(ctx, input.is_shared);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch["name"] = input.name;
  if (input.description !== undefined) patch["description"] = input.description;
  if (input.config !== undefined) {
    patch["config"] = input.config;
    patch["config_version"] = SAVED_VIEW_CONFIG_VERSION;
  }
  if (input.is_shared !== undefined) patch["is_shared"] = input.is_shared;
  if (input.is_default !== undefined) patch["is_default"] = input.is_default;

  const { data, error } = await sbOf(ctx)
    .from(TABLE)
    .update(patch)
    .eq("id", input.id)
    .eq("owner_id", uid)
    .select(COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      costingHttpError(409, "view_name_taken", "You already have a view with that name.");
    }
    throw error;
  }
  const row = data as RawView;

  const action =
    input.is_shared !== undefined && input.is_shared !== before.is_shared
      ? "costing.portfolio.view_shared"
      : input.is_default !== undefined && input.is_default !== before.is_default
        ? "costing.portfolio.view_default"
        : "costing.portfolio.view_updated";
  await costingAudit(ctx, action, TABLE, row.id, {
    company_id: companyId,
    view_id: row.id,
    view_name: row.name,
    is_shared: row.is_shared,
    is_default: row.is_default,
    before: { name: before.name, is_shared: before.is_shared, is_default: before.is_default },
    after: { name: row.name, is_shared: row.is_shared, is_default: row.is_default },
  });
  return toView(row, uid, null);
}

export async function duplicateSavedView(
  ctx: AuthContext,
  input: { id: string; name: string },
): Promise<SavedView> {
  userId(ctx);
  const { data, error } = await sbOf(ctx).from(TABLE).select(COLS).eq("id", input.id).maybeSingle();
  if (error) throw error;
  const source = (data ?? null) as RawView | null;
  // RLS already limits reads to own + company-shared views, so a readable
  // shared view may be copied even though it can never be mutated.
  if (!source) costingHttpError(404, "view_not_found", "Saved view not found.");
  return createSavedView(ctx, {
    name: input.name,
    description: source!.description,
    config: parseSavedViewConfig(source!.config),
    is_shared: false,
    is_default: false,
  });
}

export async function deleteSavedView(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const before = await loadOwn(ctx, id, uid);
  const { error } = await sbOf(ctx).from(TABLE).delete().eq("id", id).eq("owner_id", uid);
  if (error) throw error;
  await costingAudit(ctx, "costing.portfolio.view_deleted", TABLE, id, {
    company_id: companyId,
    view_id: id,
    view_name: before.name,
  });
  return { id };
}
