## Re-run `supabase/seed.sql` step 5 (link demo admin)

Steps 1–4 of the seed already landed. Only step 5 (link `demo-admin@gridmindepc.com` to Demo EPC Co with `company_admin` + `super_admin`) still needs to execute now that the user has signed up.

### What I'll do
1. Verify the auth user exists: `select id from auth.users where email = 'demo-admin@gridmindepc.com'`.
2. If found, run the step-5 DO block from `supabase/seed.sql` via the data-change tool:
   - Upsert `profiles` row (id = auth user, company_id = Demo EPC Co, full_name `Demo Admin`, email).
   - Insert `user_roles` rows for `company_admin` and `super_admin` scoped to the demo company (`on conflict do nothing`).
3. Verify: select the profile's company + slug and the two role rows.

### If the user isn't signed up yet
Stop and report the "sign up first" notice — no changes made. No schema changes; `supabase/seed.sql` itself is unchanged.
