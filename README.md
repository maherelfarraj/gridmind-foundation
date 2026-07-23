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
bun run test        # unit suite (vitest.config.ts)
bun run test:unit   # unit suite (vitest.config.ts)
bun run test:all    # full suite: unit + api + rls (vitest.config.all.ts)
```
