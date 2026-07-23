Plan: Connect and wire Lovable Cloud / Supabase

1. Verify backend connection
   - Confirm Lovable Cloud is healthy and reachable.
   - Check existing auto-generated Supabase integration files (client, middleware, attacher) and ensure `src/start.ts` registers the bearer-token middleware.

2. Configure authentication providers
   - Enable email/password auth in Cloud Auth settings.
   - Enable Google sign-in via the managed social auth flow.
   - Keep email confirmation enabled (no auto-confirm unless the user later asks).

3. Create the starter database schema
   - Add a migration that creates a `public.profiles` table with:
     - `id` (UUID, primary key)
     - `user_id` (UUID, references `auth.users(id)` on delete cascade)
     - `display_name`, `avatar_url`, `role`, `preferences`
     - `created_at`, `updated_at`
   - Add GRANT statements for `authenticated` and `service_role`.
   - Enable RLS and create policies so users can read/update their own profile.
   - Add a trigger that auto-creates a profile row when a user signs up.

4. Add auth-aware UI routes
   - Create `src/routes/auth.tsx` with email/password sign-in and sign-up, plus a Google sign-in button.
   - Create a public landing page at `src/routes/index.tsx` with a sign-in CTA and session-aware header.
   - Create a protected `src/routes/_authenticated/dashboard.tsx` as the signed-in home.
   - Wire `onAuthStateChange` in `src/routes/__root.tsx` to invalidate router and queries on sign-in/out.

5. Add session-aware header affordance
   - Replace the static placeholder with a header that shows the signed-in user's email/display name and a sign-out button when signed in, or a sign-in link when signed out.

6. Verify the build
   - Run the test suite and a local build check to ensure no type errors, missing routes, or duplicate route paths.

Technical notes
- All database schema changes go through a single migration using the migration tool.
- Auth uses the Lovable managed broker (`@/integrations/lovable` if generated, or the documented `lovable.auth.signInWithOAuth` for Google).
- `requireSupabaseAuth` server functions will be used for profile reads/writes; the bearer-token `functionMiddleware` is already in place.
- No Supabase Edge Functions are created; server logic stays in `createServerFn` and TanStack server routes.
