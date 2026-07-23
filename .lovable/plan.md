# GridMind EPC — Repository Baseline

Bring the existing TanStack Start template up to the fixed GridMind stack, install the required dependency set, and scaffold the repo skeleton. No feature code yet.

> Heads-up: Vite `^8.0.16` is not yet on npm at time of writing. If `bun add` cannot resolve it we will stop and confirm with you rather than silently downgrade — the stack pin is explicit.

## 1. `package.json`

Rewrite to pin exact versions and scripts.

- Pin (dependencies / devDependencies):
  - `vite`: `^8.0.16`
  - `react`: `^19`, `react-dom`: `^19`, `@types/react`, `@types/react-dom`
  - `typescript`: `~5.8.0`
  - `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/react-query` (v1 / v5)
  - `nitro`: `^3.0.0-beta` (Cloudflare Workers preset via TanStack Start config)
  - `tailwindcss@^4`, `@tailwindcss/vite@^4`, `tw-animate-css`
  - `vitest@^4`, `@vitest/coverage-v8`
  - `eslint@^9`, `@eslint/js`, `typescript-eslint`, `prettier`, `eslint-config-prettier`
  - App deps: `@supabase/supabase-js`, `zod`, `react-hook-form`, `@hookform/resolvers`, `date-fns`, `sonner`, `lucide-react`, `recharts`, `jspdf`, `jspdf-autotable`, `pptxgenjs`, `@fontsource/inter`, `@fontsource/dm-sans`, `@fontsource/space-grotesk`
  - shadcn prereqs: `class-variance-authority`, `clsx`, `tailwind-merge`, and Radix primitives (`@radix-ui/react-slot`, `-dialog`, `-dropdown-menu`, `-label`, `-popover`, `-select`, `-toast`, `-tabs`, `-tooltip`, `-checkbox`, `-radio-group`, `-switch`, `-separator`, `-accordion`, `-avatar`, `-scroll-area`)

- Top-level (NOT under `pnpm`):
  ```json
  "overrides": { "entities": "4.5.0" }
  ```

- Scripts (exact):
  ```json
  {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run --config vitest.config.ts",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:all": "vitest run --config vitest.config.all.ts"
  }
  ```

- `packageManager`: `bun@<current>`.

## 2. Vitest configs

- `vitest.config.ts` — unit only:
  - `test.include`: `["tests/unit/**/*.{test,spec}.{ts,tsx}"]`
  - `environment: "jsdom"`, alias `@ → src`
- `vitest.config.all.ts` — full suite via `test.projects`:
  - `unit` → `tests/unit/**` (jsdom)
  - `api` → `tests/api/**` (node)
  - `rls` → `tests/rls/**` (node)

## 3. Repo skeleton

Create (empty `.gitkeep` where needed):
```text
src/lib/
src/components/
src/routes/            (already exists — keep __root.tsx + index.tsx)
src/integrations/supabase/
supabase/migrations/
docs/
tests/unit/
tests/api/
tests/rls/
tests/e2e/
```

No standalone Node server. Server work later goes through `createServerFn` and file routes under `src/routes/api/`.

## 4. README.md

Update the test-command section so it matches exactly:
- `bun run test` / `bun run test:unit` → unit suite (`vitest.config.ts`)
- `bun run test:all` → full suite (`vitest.config.all.ts`)
Reference `bun` for all install/run commands; remove any npm/pnpm/yarn mentions.

## 5. Install & verify

- `bun install` after writing `package.json` (installs the pinned set + applies the `entities` override).
- `bun run lint` and `bun run test:unit` (empty suite passes) to confirm the toolchain wires up.
- Do NOT touch `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/styles.css`, `vite.config.ts`, `src/router.tsx`, `src/start.ts`, `src/server.ts` beyond what's needed for the new deps to load. Existing Tailwind v4 setup already matches.

## Out of scope (later tickets)

- shadcn `components.json` bootstrap and generated primitives
- Supabase client wiring in `src/integrations/supabase/`
- Any routes beyond the placeholder index
- Sample tests, RLS fixtures, migration content
