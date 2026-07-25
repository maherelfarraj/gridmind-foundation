// P-052 — Site data uploads: server functions.
// All mutations RLS-scoped via requireSupabaseAuth. Never uses service role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const SITE_DATA_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const SITE_DATA_BUCKET = "drawings";

// UI categories → document_category enum + friendly labels.
export const SITE_DATA_CATEGORIES = ["survey_topo", "geotech", "meteorological", "other"] as const;
export type SiteDataCategory = (typeof SITE_DATA_CATEGORIES)[number];

export const SITE_DATA_CATEGORY_LABEL: Record<SiteDataCategory, string> = {
  survey_topo: "Survey / topography",
  geotech: "Geotech report",
  meteorological: "Meteorological / resource",
  other: "Other site data",
};

const CATEGORY_TO_DOC: Record<SiteDataCategory, "drawing" | "report" | "datasheet" | "other"> = {
  survey_topo: "drawing",
  geotech: "report",
  meteorological: "datasheet",
  other: "other",
};

export const ALLOWED_EXTENSIONS = [
  ".dxf",
  ".dwg",
  ".pdf",
  ".csv",
  ".zip",
  ".tif",
  ".tiff",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SiteDataRow {
  id: string;
  project_id: string;
  category: string;
  title: string;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  tags: string[];
  metadata: Record<string, any>;
  created_at: string;
  created_by: string | null;
  uploader: { full_name: string | null; email: string | null } | null;
  site_data_category: SiteDataCategory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(0, 120) || "file";
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

async function loadProjectCompany(
  context: any,
  projectId: string,
): Promise<{ id: string; company_id: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string };
}

async function assertEngineeringWriter(context: any, companyId: string) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", ["engineering_admin", "engineer", "project_admin", "company_admin", "super_admin"])
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) httpError(403, "forbidden");
}

// ---------------------------------------------------------------------------
// uploadSiteData — returns a signed upload URL for the drawings bucket.
// ---------------------------------------------------------------------------
const uploadInput = z.object({
  projectId: z.string().uuid(),
  category: z.enum(SITE_DATA_CATEGORIES),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(SITE_DATA_MAX_BYTES, "File exceeds 50 MB limit"),
  mimeType: z.string().trim().max(200).optional().nullable(),
});

export const uploadSiteData = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => uploadInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertEngineeringWriter(context, project.company_id);

    const ext = extOf(data.fileName);
    if (!ALLOWED_EXTENSIONS.includes(ext as any)) {
      httpError(400, "unsupported_extension");
    }

    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeName = sanitizeFilename(data.fileName);
    const path = `${project.company_id}/${project.id}/site-data/${data.category}/${uuid}-${safeName}`;

    const { data: signed, error } = await context.supabase.storage
      .from(SITE_DATA_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw error;

    return {
      bucket: SITE_DATA_BUCKET,
      path,
      signedUrl: signed.signedUrl,
      token: signed.token,
      companyId: project.company_id,
    };
  });

// ---------------------------------------------------------------------------
// registerSiteDataDocument — creates the documents row + audit entry.
// ---------------------------------------------------------------------------
const registerInput = z.object({
  projectId: z.string().uuid(),
  category: z.enum(SITE_DATA_CATEGORIES),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative().max(SITE_DATA_MAX_BYTES),
  mimeType: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().min(1).max(200),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  metadata: z.record(z.string(), z.any()).default({}),
});

export const registerSiteDataDocument = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => registerInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    await assertEngineeringWriter(context, project.company_id);

    const prefix = `${project.company_id}/${project.id}/site-data/${data.category}/`;
    if (!data.storagePath.startsWith(prefix)) {
      httpError(400, "path_mismatch");
    }

    const tags = Array.from(new Set([`site_data:${data.category}`, ...(data.tags ?? [])]));
    const metadata = { ...data.metadata, site_data_category: data.category };

    const insertRow: Record<string, any> = {
      company_id: project.company_id,
      project_id: project.id,
      title: data.title,
      category: CATEGORY_TO_DOC[data.category],
      storage_path: data.storagePath,
      file_name: data.fileName,
      file_size_bytes: data.fileSize,
      mime_type: data.mimeType ?? null,
      tags,
      metadata,
      created_by: context.user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("documents")
      .insert(insertRow as any)
      .select("id")
      .single();
    if (error) throw error;

    await context.supabase.rpc("write_audit_log", {
      p_action: "engineering.site_data_uploaded",
      p_entity: "documents",
      p_entity_id: inserted!.id,
      p_metadata: {
        project_id: project.id,
        category: data.category,
        storage_path: data.storagePath,
        file_name: data.fileName,
        file_size_bytes: data.fileSize,
        metadata,
      },
    });

    return { id: inserted!.id };
  });

// ---------------------------------------------------------------------------
// listSiteData
// ---------------------------------------------------------------------------
export const listSiteData = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SiteDataRow[]> => {
    requireSupabaseAuth(context);

    const { data: rows, error } = await context.supabase
      .from("documents")
      .select(
        "id, project_id, category, title, storage_path, file_name, file_size_bytes, mime_type, tags, metadata, created_at, created_by",
      )
      .eq("project_id", data.projectId)
      .like("storage_path", "%/site-data/%")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const list = (rows ?? []) as any[];
    const uploaderIds = Array.from(
      new Set(list.map((r) => r.created_by).filter(Boolean)),
    ) as string[];
    const uploaders: Record<string, { full_name: string | null; email: string | null }> = {};
    if (uploaderIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uploaderIds);
      for (const p of profiles ?? []) {
        uploaders[(p as any).id] = {
          full_name: (p as any).full_name ?? null,
          email: (p as any).email ?? null,
        };
      }
    }

    return list.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, any>;
      const category = (meta.site_data_category ?? "other") as SiteDataCategory;
      return {
        id: r.id,
        project_id: r.project_id,
        category: r.category,
        title: r.title,
        storage_path: r.storage_path,
        file_name: r.file_name,
        file_size_bytes: r.file_size_bytes,
        mime_type: r.mime_type,
        tags: (r.tags ?? []) as string[],
        metadata: meta,
        created_at: r.created_at,
        created_by: r.created_by,
        uploader: r.created_by ? (uploaders[r.created_by] ?? null) : null,
        site_data_category: SITE_DATA_CATEGORIES.includes(category) ? category : "other",
      };
    });
  });

// ---------------------------------------------------------------------------
// getSiteDataDownloadUrl — 15-minute signed URL, RLS-scoped read.
// ---------------------------------------------------------------------------
export const getSiteDataDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("id, storage_path, file_name")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw error;
    if (!doc || !doc.storage_path) httpError(404, "document_not_found");

    const { data: signed, error: sErr } = await context.supabase.storage
      .from(SITE_DATA_BUCKET)
      .createSignedUrl(doc.storage_path as string, 900, {
        download: (doc.file_name as string) ?? undefined,
      });
    if (sErr) throw sErr;

    return { url: signed?.signedUrl ?? null };
  });
