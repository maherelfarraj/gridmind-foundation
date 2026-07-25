// P-127 — In-app public API reference. Static, well-typed content.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, KeyRound, ShieldCheck, Zap } from "lucide-react";

import { getCurrentUserRoles } from "@/lib/user-roles.functions";
import { API_KEY_SCOPES } from "@/lib/public-api/scopes";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/docs/api")({
  component: ApiDocsPage,
  head: () => ({
    meta: [
      { title: "API docs — GridMind EPC" },
      {
        name: "description",
        content:
          "Public API reference: authentication, HMAC signing, rate limits, endpoints, and error catalog.",
      },
      { property: "og:title", content: "GridMind EPC — Public API docs" },
      {
        property: "og:description",
        content:
          "Integrator reference for SCADA ingestion, event hooks, and outbound webhooks.",
      },
    ],
  }),
});

const SCOPE_DESCRIPTIONS: Record<(typeof API_KEY_SCOPES)[number], string> = {
  "scada:telemetry:write":
    "Ingest telemetry readings into scada_assets for your company.",
  "hooks:events": "POST generic events to /api/public/hooks/events.",
  "hooks:scada": "Post SCADA control-plane events (reserved).",
  "read:reports": "Read scheduled report metadata (reserved).",
  "webhooks:manage": "Manage outbound webhook endpoints via API (reserved).",
};

const ENDPOINTS: Array<{
  method: string;
  path: string;
  scope: string;
  signed: string;
  summary: string;
}> = [
  {
    method: "POST",
    path: "/api/public/hooks/ping",
    scope: "(any)",
    signed: "Required",
    summary:
      "Smoke test — returns { pong: true, caller, companyId } when signature verifies.",
  },
  {
    method: "POST",
    path: "/api/public/hooks/events",
    scope: "hooks:events",
    signed: "If PUBLIC_HOOK_SIGNING_SECRET set",
    summary:
      "Generic event hook. Body: { event: string, data: object }. Audited as public_hook.event_received.",
  },
  {
    method: "POST",
    path: "/api/public/hooks/scada-telemetry",
    scope: "scada:telemetry:write",
    signed: "Required",
    summary:
      "Batch upsert of up to 1,000 readings: { readings: [{ asset_key, ts, metric, value, quality? }] }. Responds { accepted, rejected, errors }.",
  },
];

const ERROR_CATALOG: Array<{ code: string; status: number; when: string }> = [
  { code: "unauthorized", status: 401, when: "Missing or invalid Bearer key." },
  {
    code: "insufficient_scope",
    status: 403,
    when: "Key does not carry the scope this endpoint requires.",
  },
  {
    code: "ip_not_allowed",
    status: 403,
    when: "Caller IP (cf-connecting-ip) not in the key's allowlist (block mode).",
  },
  {
    code: "signature_expired",
    status: 401,
    when: "x-timestamp is older or newer than 300 seconds from server time.",
  },
  {
    code: "signature_invalid",
    status: 401,
    when: "x-signature HMAC does not match the exact bytes of the request body.",
  },
  {
    code: "rate_limited",
    status: 429,
    when: "Endpoint token bucket exhausted. Retry after the Retry-After header.",
  },
  {
    code: "invalid_payload",
    status: 400,
    when: "Zod schema validation failed for the request body.",
  },
];

function ApiDocsPage() {
  const getRoles = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["current-user-roles"],
    queryFn: () => getRoles({ data: {} }),
    staleTime: 60_000,
  });
  const isCompanyAdmin = (rolesQuery.data ?? []).some(
    (r) => r.role === "company_admin" || r.role === "super_admin",
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            Integrator reference
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            GridMind EPC Public API
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed, rate-limited HTTP endpoints for SCADA vendors, third-party
            automation, and outbound webhook consumers. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              docs/public-api-signing.md
            </code>{" "}
            in the repo for runnable code samples.
          </p>
        </div>
        {isCompanyAdmin ? (
          <Button asChild size="sm">
            <Link to="/settings/api-keys">
              <KeyRound className="mr-1.5 h-4 w-4" />
              Manage keys
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Authentication */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Every request carries an{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              Authorization: Bearer gm_&hellip;
            </code>{" "}
            header. Keys are per-company and only grant access to your own
            tenant data. Keys are shown once when created — store them in a
            secret manager.
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>What it lets a key do</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {API_KEY_SCOPES.map((scope) => (
                  <TableRow key={scope}>
                    <TableCell className="font-mono text-xs">{scope}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[scope]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              <strong>401 unauthorized</strong> — key is missing, malformed,
              revoked, or expired.
            </li>
            <li>
              <strong>403 insufficient_scope</strong> — key is valid but lacks
              the scope the endpoint requires.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Signing */}
      <Card>
        <CardHeader>
          <CardTitle>Request signing (HMAC-SHA256)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Signed endpoints require both a Unix-seconds timestamp and an HMAC
            signature computed over the exact request bytes:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
{`x-timestamp: 1737849600
x-signature: sha256=<hex(hmac_sha256(secret, \`\${timestamp}.\${rawBody}\`))>`}
          </pre>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              The signing secret is your API key value — the same{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                gm_&hellip;
              </code>{" "}
              string shown once at creation.
            </li>
            <li>
              Replay window: <strong>300 seconds</strong>. Skew outside that
              range returns{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                signature_expired
              </code>
              .
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                signature_invalid
              </code>{" "}
              means the HMAC does not match. The most common cause is
              re-serializing the body after signing — sign the exact bytes you
              transmit.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Rate limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Rate limits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            A token bucket is applied per <em>endpoint × key</em>. Exhausting
            it returns HTTP <strong>429 rate_limited</strong> with a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              Retry-After
            </code>{" "}
            header (seconds). Honor it, then apply exponential backoff with
            jitter for repeated failures.
          </p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              scada-telemetry: 120 burst, ~2 req/s sustained — batch readings
              in a single POST.
            </li>
            <li>
              ping / events: modest bursts, generous sustained rate; used for
              smoke tests and low-volume integrations.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ENDPOINTS.map((e) => (
                  <TableRow key={e.path}>
                    <TableCell>
                      <Badge variant="secondary">{e.method}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.path}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.scope}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.signed}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.summary}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">
              Outbound webhook verification
            </h3>
            <p className="text-sm text-muted-foreground">
              When you receive a delivery from GridMind at your registered
              endpoint, verify these headers over the raw request body:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
{`x-gridmind-timestamp: 1737849600
x-gridmind-signature: sha256=<hex(hmac_sha256(endpoint_secret, \`\${timestamp}.\${rawBody}\`))>`}
            </pre>
            <p className="text-sm text-muted-foreground">
              Signing symmetry with the inbound guard: verify the timestamp is
              within 300 seconds and reject signature mismatches. The endpoint
              secret is shown once when you register the endpoint in{" "}
              <em>Settings &rarr; Webhooks</em>.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Errors */}
      <Card>
        <CardHeader>
          <CardTitle>Error catalog</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ERROR_CATALOG.map((e) => (
                  <TableRow key={e.code}>
                    <TableCell className="font-mono text-xs">{e.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.when}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Applies to both plant O&amp;M ingestion and C&amp;I integration
            surfaces.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
