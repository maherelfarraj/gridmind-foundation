## Plan: GridMind EPC Design System

### 1. Rewrite `src/styles.css`
- Keep `@import "tailwindcss" source(none);`, `@source "../src";`, `@import "tw-animate-css";`.
- Add Fontsource imports (top of file, before `@theme`):
  - `@fontsource/inter/400.css`, `/500.css`, `/600.css`, `/700.css`
  - `@fontsource/space-grotesk/500.css`, `/700.css`
  - `@fontsource/dm-sans/400.css`, `/500.css`
- Keep `@custom-variant dark (&:is(.dark *));`.
- `@theme inline` block: keep existing `--color-*` mappings; add font tokens:
  - `--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;`
  - `--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;`
  - `--font-alt: "DM Sans", ui-sans-serif, system-ui, sans-serif;`
- Rewrite `:root` and `.dark` OKLCH values to an industrial EPC palette:
  - Light: near-white desaturated slate background, deep muted blue primary (~oklch(0.35 0.08 250)), muted green accent (~oklch(0.55 0.09 155)), muted red destructive (~oklch(0.55 0.15 25)), slate neutrals for muted/border/input/ring, plus matching sidebar tokens.
  - Dark: deep desaturated slate background (~oklch(0.18 0.02 250)), foreground near-white, brighter muted blue primary (~oklch(0.65 0.10 250)), green accent (~oklch(0.62 0.10 155)), same-family destructive, elevated slate card/popover.
  - `--chart-1..5`: blue, green, amber, slate, teal — all low saturation.
  - `--radius: 0.5rem`.
- Add a `body { font-family: var(--font-sans); }` base rule so Inter is the default body font.

### 2. Theme provider — `src/components/theme-provider.tsx`
- `type Theme = "light" | "dark" | "system"`.
- `ThemeProvider` sets a `<html class="dark">` toggle:
  - Initial resolution: `localStorage.getItem("gridmind-theme")` → else `prefers-color-scheme`.
  - Persist to `localStorage` on change.
  - Subscribe to `matchMedia('(prefers-color-scheme: dark)')` when in `system` mode.
  - SSR-safe: apply class in a `useEffect`; provide a small inline script via `__root.tsx` head to set the class before hydration to avoid flash (optional but recommended).
- Export `useTheme()` returning `{ theme, resolvedTheme, setTheme }`.

### 3. Wire provider in `src/routes/__root.tsx`
- Wrap the existing `AuthProvider`/app tree inside `<ThemeProvider>`.
- Add a small `<script>` tag in root `head` that reads localStorage and sets `document.documentElement.classList` early (no-flash).

### 4. Header theme toggle
- Add a `ThemeToggle` button (lucide `Sun`/`Moon`) to the existing header in `__root.tsx` — cycles light ↔ dark. Uses only semantic classes.

### 5. Demo page — `src/routes/design-system.tsx`
- Route showcasing:
  - Color swatches for every semantic token (background/foreground/card/primary/secondary/muted/accent/destructive/border/sidebar/chart-1..5).
  - Font samples for `font-sans`, `font-display`, `font-alt`.
  - Buttons using existing shadcn `Button` variants.
  - A prominent `ThemeToggle` at the top to prove switching works.
  - `head()` with unique title/description/OG metadata.

### 6. Guardrails
- Do not touch generated files (`routeTree.gen.ts`, supabase integration).
- All new/edited components use semantic classes only — no hex, `rgb()`, or arbitrary color values.

### Verification
- `bun run build` succeeds.
- Preview `/` renders with new palette; `/design-system` toggle flips light/dark and persists across reload.

No new dependencies needed — Fontsource packages and lucide-react are already installed.