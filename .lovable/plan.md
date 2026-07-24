## P-052 — Site data uploads to `drawings` bucket

### 1. Migration `0018_documents_metadata.sql`
- `alter table public.documents add column if not exists metadata jsonb not null default '{}';`
- No RLS/grant changes.

### 2. Server functions — `src/lib/site-data.functions.ts`
All `createServerFn` + zod + `requireSupabaseAuth`; use `context.supabase` (user-scoped, RLS). Never use service role.

- `uploadSiteData({ projectId, category, fileName, fileSize, mimeType })`
  - Enforce role: caller must have `engineering_admin | engineer | project_admin` (query `user_roles` via `context.supabase`).
  - Resolve project → `company_id` (RLS enforces membership).
  - Reject `fileSize > 50 * 1024 * 1024` (server-side belt).
  - Validate `category ∈ document_category` enum.
  - Build path: `{company_id}/{project_id}/site-data/{category}/{crypto.randomUUID()}-{sanitized filename}`.
  - Return signed upload URL via `context.supabase.storage.from('drawings').createSignedUploadUrl(path)` + the resolved `path` + `company_id`.
- `registerSiteDataDocument({ projectId, storagePath, fileName, fileSize, mimeType, category, title, tags, metadata })`
  - Re-check role + resolve `company_id`.
  - Sanity-check `storagePath` starts with `{company_id}/{project_id}/site-data/{category}/`.
  - Insert into `public.documents` (populate `metadata` jsonb + `tags[]` + `created_by = context.userId`).
  - `write_audit_log('engineering.site_data_uploaded','documents', new_id, { projectId, category, storagePath, metadata })`.
  - Return the inserted row.
- `listSiteData({ projectId })` — select from `documents` where `project_id=?` and `storage_path like '%/site-data/%'`, ordered by `created_at desc`, joined with uploader display name via a follow-up profiles fetch.
- `getSiteDataDownloadUrl({ documentId })` — RLS-scoped fetch of `storage_path`, then `createSignedUrl(path, 900)` (15 min).

### 3. Query layer — `src/lib/site-data-query.ts`
- `siteDataListQueryOptions(projectId)` (staleTime 30s).
- Mutation hooks: `useUploadSiteData`, `useRegisterSiteDataDocument`, `useSiteDataDownload`.
- Invalidate the list on register success.

### 4. Route — `src/routes/_authenticated/projects.$projectId.engineering.uploads.tsx`
- Loader: `ensureQueryData(siteDataListQueryOptions(projectId))`.
- Head metadata (unique title/description).
- Renders `<SiteDataUploads projectId=… />`.

### 5. Update engineering tab index
- Convert `projects.$projectId.engineering.tsx` into a layout (`<Outlet />`) with a small sub-nav linking to Uploads (extendable later for register/markups).
- Add `projects.$projectId.engineering.index.tsx` keeping the current placeholder as the default landing.

### 6. UI components (`src/components/engineering/`)
- `SiteDataUploads.tsx` — orchestrates dropzone + queue + list; role-gated (hide/disable actions for viewers).
- `SiteDataDropzone.tsx` — HTML5 drag-and-drop (no new dep; replicate react-dropzone pattern with `useState` + `onDrop`). Accepts `.dxf, .dwg, .pdf, .csv, .zip, .tif, .tiff`; client-side 50 MB check with sonner error.
- `SiteDataCategoryDialog.tsx` — after drop, per-file wizard: pick category then render typed metadata form via `react-hook-form + zod`:
  - `survey_topo`: date, EPSG, surveyor, units.
  - `geotech`: report number, lab, boring count, groundwater depth (m).
  - `meteorological`: source, station, data period start/end.
  - Others → free-form title only.
  - Metadata compiled into `{ ...typed }` jsonb + human tags (e.g. `['geotech','lab:acme']`). Category maps to `document_category` (`report | datasheet | other` etc.; `survey_topo → other`, `geotech → report`, `meteorological → datasheet`).
- `SiteDataQueue.tsx` — per-file progress bar driven by `XMLHttpRequest` upload against the signed URL (fetch has no progress); on 200 → call `registerSiteDataDocument`; on error → retry button.
- `SiteDataList.tsx` — table with type badge, uploader, uploaded date, "Download" (calls `getSiteDataDownloadUrl` then `window.open`).
- Skeleton (list loading), empty state ("No site data uploaded yet — drop DXF, topo or geotech files"), error state with retry.
- Semantic tokens only (`bg-card`, `border-border`, `text-muted-foreground`, `text-destructive`).

### 7. Verification (post-approval, manual)
- Migration re-check via `supabase--read_query`: `metadata` column exists on `public.documents`.
- Playwright: upload a PDF as geotech with metadata → confirm `documents` row + audit row + storage path prefix.
- >50 MB rejected client + server side.
- Signed download URL works; direct storage URL denied.
- Empty/skeleton/error states render.

### Technical notes
- No new npm deps — dropzone + progress built from React + XHR.
- Signed upload URL avoids proxying file bytes through the server function.
- All uploads happen browser → Supabase storage using the user's session; RLS on `storage.objects` (`storage_company_id`) already enforces the company prefix.

next → P-053 after green.