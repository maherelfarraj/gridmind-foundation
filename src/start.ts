// Global middleware chain (outer → inner):
//   requestMiddleware:  [errorMiddleware]      — wraps every SSR/route/serverFn request
//   functionMiddleware: [attachSupabaseAuth]   — runs per createServerFn RPC
//
// errorMiddleware rules:
//   • Bypass entirely for paths starting with "/lovable/" and the exact
//     path "/email/unsubscribe" (Lovable preview iframe + unsubscribe links
//     must never see a branded interstitial).
//   • Re-throw untouched when the caught error has a numeric `statusCode`
//     (preserves 401/404/429/... intended by TanStack/h3).
//   • Everything else → captureError() + branded HTML 500 via renderErrorPage().
import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { captureError } from "./lib/error-capture";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

function shouldBypass(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/lovable/") || pathname === "/email/unsubscribe";
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  let pathname: string | undefined;
  try {
    pathname = request ? new URL(request.url).pathname : undefined;
  } catch {}

  if (shouldBypass(pathname)) {
    return next();
  }

  try {
    return await next();
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
    ) {
      const e = error as {
        statusCode: number;
        body?: unknown;
        headers?: Record<string, string>;
      };
      if (typeof e.body === "string") {
        return new Response(e.body, {
          status: e.statusCode,
          headers: e.headers ?? { "content-type": "text/plain; charset=utf-8" },
        });
      }
      throw error;
    }
    const { errorRef } = captureError(error, { path: pathname });
    return new Response(renderErrorPage({ errorRef }), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
