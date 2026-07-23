
-- Signup was failing: handle_new_user trigger tried to insert into profiles.company_id (NOT NULL) with no company.
-- Fix: drop the auto-profile trigger. Profiles are created explicitly by seed step 5 or by redeem_invite.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
