import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "src/integrations/supabase/types.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  // P-134 — Console hygiene. Allow warn/error/info in src; block console.log
  // (and every non-listed method) so stray debug logs cannot reach production.
  // src/lib/error-capture.ts is the sanctioned console.error sink; all other
  // files should either throw + let captureError log, or use warn/info.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
    },
  },
  // tests/** — only console.info is permitted (smoke-step logging).
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["info"] }],
    },
  },
  eslintPluginPrettier,
);
