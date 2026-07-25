# GridMind EPC

Built with [Lovable](https://lovable.dev). Package manager: **bun**.

## Stack

- Vite 8, React 19, TypeScript 5.8
- TanStack Start v1 + TanStack Router v1 + TanStack Query v5
- Tailwind CSS v4
- Nitro 3 (beta) — Cloudflare Workers edge runtime for SSR
- Vitest 4, ESLint 9, Prettier
- Supabase JS client

Server logic runs as `createServerFn` RPC and HTTP routes under `src/routes/api/`. There is no separate Node server.

## Development

```sh
bun install
bun run dev
```

## Scripts

```sh
bun run dev         # start dev server
bun run build       # production build
bun run preview     # preview production build
bun run lint        # eslint
bun run format      # prettier --write .
bun run test        # unit suite (vitest.config.ts) — offline, default
bun run test:unit   # unit suite (vitest.config.ts) — offline, default
bun run test:all    # full suite: unit + api + rls + e2e (vitest.config.all.ts)
```

`bun run test` / `bun run test:unit` run only `tests/unit/**` and require no
dev server. `bun run test:all` additionally runs `tests/api/**`,
`tests/rls/**`, and `tests/e2e/**`; those suites self-skip via
`tests/helpers/dev-server.ts` when the dev server at
`http://localhost:8080` is unreachable, so the command stays green offline.
Start `bun run dev` in another shell to actually exercise them.

