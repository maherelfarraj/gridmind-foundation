## P-008 verification — all green ✅

Reviewed `src/routes/(auth)/{route,login,signup,forgot-password,reset-password}.tsx` earlier this turn. Every checklist item passes; no code changes required.

| Check | Result |
|---|---|
| All 4 routes render inside shared centered-card `(auth)` layout | ✅ `route.tsx` wraps `<Outlet />` in a bordered card on `bg-muted` |
| Bad credentials show generic error (never per-field) | ✅ `login.tsx` toasts `"Invalid email or password"` on any auth error |
| Google OAuth uses `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })` | ✅ Public same-origin URL, no protected route |
| Signup shows check-inbox confirmation state | ✅ `sentTo` state renders the CheckCircle2 confirmation view |
| Forgot-password is enumeration-safe | ✅ Fire-and-forget; always shows "If an account exists…" |
| Reset validates match, calls `updateUser`, redirects to `/login` | ✅ Zod `.refine` match check; success → `signOut()` + navigate to `/login` |
| Authed visitors redirected to `/` (except `/reset-password` recovery) | ✅ `beforeLoad` in `route.tsx` exempts `/reset-password` only |
| All styling uses semantic tokens | ✅ `bg-muted`, `bg-card`, `text-foreground`, `text-primary`, `border-border`, etc. — no hex/rgb in app chrome |

### Note on the Google glyph hex
The `GoogleGlyph` SVG in `login.tsx` uses `#EA4335` — Google's mandated brand color for their sign-in button, not app styling. If you want it swapped to a monochrome `currentColor` glyph to keep the "zero hex in components" rule absolutely literal, say so and I'll change it in build mode.

### Next
Ready for **Batch 02 / P-009** — paste the spec whenever you're ready. 🏁