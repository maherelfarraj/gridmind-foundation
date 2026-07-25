# P-116 — Portal audit events + curation admin

Table + writers already exist (`portal_audit_events`, `_portal_log`, plus writes from `portal_get_feed`, `portal_raise_ticket`, `portal_decide_approval`, and share-link resolution). This batch surfaces the log to admins and tightens exposure curation UX. No new tables.

## 1. Server functions — `src/lib/portal-audit.functions.ts`

All `requireSupabaseAuth` + `company_admin`/`super_admin` gated. Queries scope on `company_id` via `is_company_member`.

- `listPortalAuditEvents({ project_id?, membership_id?, event?, since?, limit=100, cursor? })` — cursor-paginated (created_at desc). Joins profile display name + membership label for the table. Rejects `is_external_viewer`.
- `getPortalAuditSummary({ project_id?, days=30 })` — grouped counts by event type + top viewers, for the header stat tiles.
- `listPortalMembershipsForFilter()` — lightweight list (id, label, project_id, user_email) for the filter dropdown.

## 2. Curation admin refinements — `src/routes/_authenticated/settings.portal-members.tsx`

Additive edits only:

- Add per-row "View activity" button → deep-links `/settings/portal-audit?membership_id=…`.
- Add exposure preset chips ("Milestones only", "Milestones + KPIs", "Full read-only") that patch the exposure toggles atomically.
- Confirm dialog on exposure downgrade (removing a section that was on) to reinforce curation intent; write `portal.exposure_updated` via existing `_portal_log` from `updatePortalMembership` (add if missing).

## 3. Audit viewer route — `src/routes/_authenticated/settings.portal-audit.tsx`

`company_admin` only, otherwise 403 empty state.

- Header stat tiles: total views (30d), unique viewers, tickets raised, approvals decided — from `getPortalAuditSummary`.
- Filter bar: project, membership, event type multi-select (`portal.feed_viewed`, `portal.ticket_raised`, `portal.approval_decided`, `portal.exposure_updated`, `share_link.viewed`), date range preset (24h/7d/30d/90d).
- Table: timestamp, event badge, actor (email or "share link"), project, membership label, metadata inline (`priority`, `decision`, `ticket_id`, etc.). Skeleton, empty state ("No portal activity yet"), error retry — same pattern as share-links.
- Cursor-based "Load more" pagination.
- CSV export button (client-side blob) — uses `exportGuardBadge` pattern? No — audit exports are not project-scoped exports; skip the export lock.
- Semantic tokens only; no raw hex.

## 4. Sidebar

Add `Portal audit` nav entry under Settings section, `company_admin` gated (reuse existing role check pattern from `settings.share-links`).

## 5. Verification

- Typecheck clean.
- Manual: create a portal membership, load `/portal/projects/$id` as that user → `portal.feed_viewed` row appears in the viewer. Raise a ticket → `portal.ticket_raised`. Resolve a share link in incognito → `share_link.viewed` with `actor` null. Downgrade exposure → `portal.exposure_updated`.
- External viewers (`client_viewer`/`investor_viewer`/`lender_viewer`) get 403 on the audit route (RLS already blocks the select).

## Out of scope

- No new migration (schema is sufficient).
- No changes to `_portal_log` signature.
- No retention/archival policy (would be a separate batch).
