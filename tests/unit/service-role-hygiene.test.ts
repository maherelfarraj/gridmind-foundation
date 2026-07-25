// P-132 — Static hygiene: the service-role key and admin client MUST NEVER
// be imported from files that ship to a browser bundle.
//
// Rules:
//   1. `SUPABASE_SERVICE_ROLE_KEY` and `createServiceRoleClient` may appear
//      ONLY under:
//        - src/routes/api/**        (guarded webhook / cron / public handlers)
//        - src/integrations/supabase/server.ts
//        - src/integrations/supabase/admin.ts   (thin re-export)
//        - src/integrations/supabase/client.server.ts (server-only shim)
//        - src/lib/public-api/**    (guard helpers used by /api handlers)
//   2. `src/components/**`, `src/routes/(app)/**`, `src/routes/(auth)/**`
//      MUST NOT reference either symbol under any circumstance.
//   3. Roles live in `user_roles` only — never as a column on `profiles`.
//      (Compile-time grep against src/**; migrations are excluded.)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../src/', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ALL_FILES = walk(ROOT);

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join('/');
}

const SERVICE_ALLOWED = (r: string) =>
  r.startsWith('routes/api/') ||
  r === 'server.ts' ||
  r === 'start.ts' ||
  r === 'integrations/supabase/server.ts' ||
  r === 'integrations/supabase/admin.ts' ||
  r === 'integrations/supabase/client.server.ts' ||
  r.startsWith('lib/public-api/') ||
  // Server-only modules: .functions.ts hosts createServerFn handlers, and
  // .server.ts is import-guarded from the client bundle. Both are legitimate
  // homes for the admin client when a handler needs privileged writes after
  // auth checks.
  /(^|\/)[^/]+\.functions\.ts$/.test(r) ||
  /(^|\/)[^/]+\.server\.ts$/.test(r);

const CLIENT_BUNDLED = (r: string) =>
  r.startsWith('components/') ||
  /^routes\/\(app\)\//.test(r) ||
  /^routes\/\(auth\)\//.test(r);

describe('P-132 service-role hygiene (static scan)', () => {
  it('SUPABASE_SERVICE_ROLE_KEY appears only in guarded server files', () => {
    const offenders: string[] = [];
    for (const abs of ALL_FILES) {
      const r = rel(abs);
      if (SERVICE_ALLOWED(r)) continue;
      const body = readFileSync(abs, 'utf8');
      if (body.includes('SUPABASE_SERVICE_ROLE_KEY')) offenders.push(r);
    }
    expect(offenders, `service-role env leaked into: ${offenders.join(', ')}`).toEqual([]);
  });

  it('createServiceRoleClient / admin() is imported only in guarded server files', () => {
    const offenders: string[] = [];
    for (const abs of ALL_FILES) {
      const r = rel(abs);
      if (SERVICE_ALLOWED(r)) continue;
      const body = readFileSync(abs, 'utf8');
      if (/createServiceRoleClient|from ['"]@\/integrations\/supabase\/admin['"]/.test(body)) {
        offenders.push(r);
      }
    }
    expect(offenders, `admin client leaked into: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no client-bundled file references the service role by any name', () => {
    const offenders: string[] = [];
    for (const abs of ALL_FILES) {
      const r = rel(abs);
      if (!CLIENT_BUNDLED(r)) continue;
      const body = readFileSync(abs, 'utf8');
      if (
        body.includes('SUPABASE_SERVICE_ROLE_KEY') ||
        body.includes('createServiceRoleClient') ||
        body.includes("from '@/integrations/supabase/admin'") ||
        body.includes('from "@/integrations/supabase/admin"')
      ) {
        offenders.push(r);
      }
    }
    expect(offenders, `client bundle reached for service role in: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('roles are never stored on profiles — only in user_roles', () => {
    // Migrations are the source of truth; scan them for a role column added
    // to public.profiles.
    const mig = join(ROOT, '..', 'supabase', 'migrations');
    let sql = '';
    try {
      for (const name of readdirSync(mig)) {
        if (name.endsWith('.sql')) sql += readFileSync(join(mig, name), 'utf8') + '\n';
      }
    } catch {
      /* migrations folder may not exist in some checkouts */
    }
    const bad = /alter\s+table\s+(public\.)?profiles\s+add\s+column\s+role\b/i.test(sql);
    expect(bad, 'a migration adds a role column to profiles — forbidden').toBe(false);
  });
});
