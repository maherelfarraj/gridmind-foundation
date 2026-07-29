// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// React Email's htmlparser2 path deep-imports `entities/lib/*.js`, removed in
// entities v5+. jsdom (test env) needs modern entities, so we keep the hoisted
// copy current and route only the legacy deep imports at the v4.5.0 alias
// installed as `entities-v4`.
const entitiesV4 = path.resolve(__dirname, "node_modules/entities-v4");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        "entities/lib/decode.js": path.join(entitiesV4, "lib/decode.js"),
        "entities/lib/encode.js": path.join(entitiesV4, "lib/encode.js"),
        "entities/lib/escape.js": path.join(entitiesV4, "lib/escape.js"),
      },
    },
  },
});
