## P-030 — Profile settings

Build `/settings/profile` for every authenticated user. Mirrors the P-029 shape (server fns + zod + audit + signed URLs + semantic tokens). Roles/email are never editable here.

### 1. Migration `0014_notification_prefs.sql`
Create `public.notification_prefs` as specified (PK user_id → profiles.id, `email_enabled`, `in_app_enabled`, `prefs jsonb`, `updated_at`), enable RLS, add owner-only policy, GRANT SELECT/INSERT/UPDATE/DELETE to `authenticated` and ALL to `service_role`, and attach the shared `update_updated_at_column` trigger. Verify columns + policies after apply.

### 2. `src/lib/profile.functions.ts` (new)
All `createServerFn` + `attachSupabaseAuth` + `requireSupabaseAuth` + zod:

- `getProfileSettings` — returns `{ profile: {id, full_name, email, locale, avatar_url, company_id}, avatarSignedUrl, notificationPrefs }`. Signs `avatar_url` from `photos` bucket (300s TTL). Creates a default `notification_prefs` row lazily if missing (or returns defaults without insert).
- `updateProfile` — zod: `full_name` 2–80, `locale` enum `['en','es','de','fr','pt']`. Updates `profiles` for `auth.uid()`. Audits `profile.updated` with changed-field diff.
- `getAvatarUploadTarget` — returns `{ bucket: 'photos', path: '{company_id}/avatars/{user_id}' }` for client-side upload via signed upload URL (createSignedUploadUrl) — same pattern as logo.
- `setProfileAvatar` — validates path prefix starts with the caller's company UUID and ends `/avatars/{user_id}`, updates `profiles.avatar_url`. Audits `profile.updated` with `{ avatar: true }`.
- `removeProfileAvatar` — deletes storage object, nulls `avatar_url`. Audits.
- `updateNotificationPrefs` — zod: `email_enabled`, `in_app_enabled` booleans; `prefs` object with 5 booleans (`approvals`, `mentions`, `invites`, `report_delivery`, `alarm_escalation`). Upsert to `notification_prefs` for `auth.uid()`. Audits `notification_prefs.updated`.

### 3. `src/routes/_authenticated/settings.profile.tsx` (new)
- Load with `useQuery(getProfileSettings)`; skeleton while loading; error card + retry on failure.
- Three cards, react-hook-form + zod resolver, sonner toasts:
  - **Profile**: `full_name` input, circular avatar preview with Upload/Remove buttons (client-side ≤ 2 MB image type check, upload via signed upload URL then call `setProfileAvatar`), email shown disabled/read-only. Save button → `updateProfile`.
  - **Locale**: Select with 5 native-label options; part of the same profile form or separate mini-form — save via `updateProfile`.
  - **Notifications**: two master Switches (email, in-app) + 5 per-event Checkboxes bound to `prefs`. Helper note under email toggle referencing `/email/unsubscribe`. Save via `updateNotificationPrefs`.
- Semantic tokens only (`bg-card`, `border-border`, `text-foreground`, etc). No role or email fields anywhere.

### 4. `src/lib/nav-map.ts`
Add "Profile" entry to the Account/Settings section (visible to all authenticated roles) pointing to `/settings/profile`.

### 5. Verification (after build)
Run as demo-admin via Playwright: save name+locale, upload avatar (confirm path `{company_uuid}/avatars/{user_uuid}`), toggle notifications, then query `profiles`, `notification_prefs`, and `audit_logs` to confirm rows + `profile.updated` / `notification_prefs.updated` entries; confirm no email/role fields are editable.
