## Acceptance check — GridMind EPC design system

All five criteria pass. No code changes needed.

### Results

- [x] **Tailwind v4 `@import` + `@theme` with full token list** — `src/styles.css` uses `@import "tailwindcss"` plus `@theme inline` mapping every required token: `--background`, `--foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive(-foreground)`, `--border`, `--input`, `--ring`, sidebar tokens (`--sidebar-background/-foreground/-primary/-accent/-border` + primary-foreground/accent-foreground/ring), `--chart-1..5`, and `--radius`.
- [x] **Low-saturation palette + `.dark` remap** — chroma held at 0.02–0.15 across the palette (slate/blue neutrals, deep-blue primary `oklch(0.38 0.08 252)`, green accent `oklch(0.55 0.09 155)`, muted red destructive `oklch(0.55 0.15 25)`). `.dark` block remaps every token to dark equivalents.
- [x] **Fontsource + font tokens** — `@fontsource/inter` (400/500/600/700), `@fontsource/space-grotesk` (500/700), `@fontsource/dm-sans` (400/500) imported at the top of `styles.css`; `@theme` defines `--font-sans` (Inter), `--font-display` (Space Grotesk), `--font-alt` (DM Sans), enabling `font-sans` / `font-display` / `font-alt` utilities.
- [x] **Theme toggle: localStorage + prefers-color-scheme** — `src/components/theme-provider.tsx` reads `gridmind-theme` from localStorage, falls back to `matchMedia('(prefers-color-scheme: dark)')`, subscribes to system changes while in `system` mode, and persists on change. `__root.tsx` runs a pre-hydration inline script to apply the class before first paint (no-flash).
- [x] **No raw hex/rgb in component code** — repo-wide scan of `src/**/*.tsx` returns only shadcn's `src/components/ui/chart.tsx`, where `#ccc` / `#fff` appear inside attribute selectors (`[stroke='#ccc']`) matching Recharts' own inline DOM attributes; the applied utilities are semantic (`stroke-border`, `stroke-transparent`, `fill-muted`). Not a token violation.

### Proposed action

None — everything is green. Approve this plan and I'll leave the design system as-is.