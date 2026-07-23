## P-007 verification — all green

| Check | Result |
|---|---|
| `_authenticated` layout renders `AppShell` (sidebar + header); mobile becomes Sheet via shadcn `Sidebar collapsible="icon"`; `Ctrl/Cmd+B` toggles (`SIDEBAR_KEYBOARD_SHORTCUT="b"` in `src/components/ui/sidebar.tsx`) | Pass |
| Nav gated by `getVisibleModules(role, planTier)` in `src/lib/permissions.ts`; hidden (not disabled) when off; `green_hydrogen` requires `enterprise` (`MODULE_PLAN_REQUIREMENTS.green_hydrogen = "enterprise"`) | Pass |
| Header has `CompanySwitcher`, `NotificationsBell` (badge + dropdown), `UserMenu` with Supabase `signOut` | Pass |
| Semantic tokens only — grep for hex/rgb across `src/components` and `src/routes/_authenticated` shows only Recharts SVG attribute selectors inside `ui/chart.tsx` (matching `stroke='#ccc'` / `#fff` on Recharts internals), not styling color values | Pass |
| Sidebar collapse persists across reloads via `sidebar_state` cookie (shadcn default); active company persists via `localStorage["gridmind:active-company"]` | Pass |
| Dashboard renders KPI cards + skeleton → empty-state transition (`Recent activity`) | Pass |
| Copy: `"Operate O&M"` and `"Green H₂"` spelled correctly in `NAV_SECTIONS` | Pass |

Note: sidebar state uses a cookie rather than localStorage (shadcn default). It still satisfies the "persists across reloads" requirement; flag if you want the storage medium switched.

## Next → P-008 (auth pages — final of Batch 01)

Awaiting the P-008 spec. Once you paste it I'll plan the sign-in / sign-up / password-reset routes wired to the existing Supabase client, the `_authenticated` guard redirect, and the branded auth layout using the design tokens.
