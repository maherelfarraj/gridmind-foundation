import "./lib/error-capture";

import { captureError, consumeLastCapturedError, mintRequestId } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  LOVABLE_API_KEY?: string;
  PUBLIC_HOOK_ENFORCE?: string;
  PUBLIC_HOOK_IP_ALLOWLIST?: string;
  PUBLIC_HOOK_SIGNING_SECRET?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type ServerEntry = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function safePath(request: Request): string | undefined {
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
}

function requestIdFor(request: Request): string {
  return request.headers.get("x-request-id") ?? mintRequestId();
}

function brandedErrorResponse(errorRef: string, requestId: string): Response {
  return new Response(renderErrorPage({ errorRef, requestId }), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-request-id": requestId,
    },
  });
}

function shouldBypassBranding(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/lovable/") || pathname === "/email/unsubscribe";
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (response.status < 500) return response;
  const path = safePath(request);
  if (shouldBypassBranding(path)) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const original = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  const { errorRef } = captureError(original, { route: path, requestId });
  return brandedErrorResponse(errorRef, requestId);
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = safePath(request);
    const requestId = requestIdFor(request);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request, requestId);
    } catch (error) {
      if (shouldBypassBranding(path)) throw error;
      const { errorRef } = captureError(error, { route: path, requestId });
      return brandedErrorResponse(errorRef, requestId);
    }
  },
};
