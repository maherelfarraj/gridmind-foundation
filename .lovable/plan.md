## P-008 — Public auth pages

Replace the current combined `src/routes/auth.tsx` with a split, shared-layout auth flow, and rewire the two callers that point at `/auth`.

### Files

**New — pathless group with shared centered-card layout**
- `src/routes/(auth)/route.tsx` — layout route. `beforeLoad` calls `supabase.auth.getUser()`; if a session exists → `throw redirect({ to: "/" })`. Component renders the centered card shell (bg-muted backdrop, bg-card border-border card, Space Grotesk "GridMind EPC" wordmark, tagline "The operating system for renewable EPC") wrapping `<Outlet />`. Uses TanStack route-group parentheses so the URLs stay `/login`, `/signup`, etc.
- `src/routes/(auth)/login.tsx` → `/login`
  - RHF + zod (email, password min 8), `supabase.auth.signInWithPassword`
  - Success → `navigate({ to: "/", replace: true })`
  - Failure → generic toast "Invalid email or password" (no field-level reveal)
  - "Forgot password?" `<Link to="/forgot-password">`
  - "Continue with Google" button → `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })` (Lovable Cloud managed OAuth per knowledge; NOT raw `supabase.auth.signInWithOAuth`). Includes Google glyph SVG icon.
  - Head meta: unique title/description/og pair
- `src/routes/(auth)/signup.tsx` → `/signup`
  - Fields: full_name, email, password (zod: min 8, ≥1 digit via regex)
  - `supabase.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: window.location.origin } })`
  - On success swap the card body to a "Check your inbox to verify your email" confirmation state with a "Back to sign in" link
- `src/routes/(auth)/forgot-password.tsx` → `/forgot-password`
  - Email only; `resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/reset-password\` })`
  - Always render the same success card (no enumeration) regardless of Supabase result
- `src/routes/(auth)/reset-password.tsx` → `/reset-password`
  - Public route (also inside the `(auth)` layout so the shell matches) — but exempt from the session redirect: recovery links land here with an active session, so the `beforeLoad` needs a `location.pathname === "/reset-password"` bypass. Otherwise the recovered user would be bounced to `/`.
  - Fields: new password, confirm password (zod `.refine` match, min 8 + 1 digit)
  - `supabase.auth.updateUser({ password })`; success → toast + `navigate({ to: "/login", replace: true })`

**Modified**
- Delete `src/routes/auth.tsx` (`rm`) — replaced by `(auth)/login.tsx`.
- `src/routes/__root.tsx` — change the sign-out `router.navigate({ to: "/auth" })` and the header `<Link to="/auth">` sign-in CTA to `to: "/login"`.
- `src/routes/_authenticated/route.tsx` — change the unauthenticated `throw redirect({ to: "/auth" })` to `{ to: "/login" }`.

### Shared UI conventions

- All forms: shadcn `Form` + `FormField`/`FormMessage`, `Button` with `Loader2` spinner while `isSubmitting`, `disabled={isSubmitting}`.
- Only semantic tokens (`bg-muted`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`); no hex/rgb.
- Toasts via `sonner`.
- Copy stays professional; no jargon terms appear on these pages, but the "O&M / C&I / Green H₂" spellings remain enforced elsewhere.

### Route-group note

TanStack Router supports `(group)` pathless directories in current versions of the file-based router plugin. If the generator rejects the parentheses on the installed version, fall back to a `_auth` pathless prefix (`src/routes/_auth.route.tsx`, `_auth.login.tsx`, …) — URLs and behavior unchanged.

### Verification

- Typecheck passes; `routeTree.gen.ts` regenerates with `/login`, `/signup`, `/forgot-password`, `/reset-password`.
- Visiting `/login` while signed in redirects to `/`.
- Visiting `/reset-password` via a recovery link does NOT redirect away.
- `rg "#[0-9a-fA-F]{3,8}|rgb\(|rgba\(" src/routes/\(auth\)` returns nothing.
