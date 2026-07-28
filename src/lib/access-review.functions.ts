// Access certification — super-admin only. Lists active users across all
// tenants with their company membership, roles, and last sign-in for
// periodic access review/export. Read-only; no mutations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

export type AccessReviewRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  companyId: string;
  companyName: string | null;
  roles: string[];
  lastSignInAt: string | null;
  createdAt: string;
};

export type AccessReview = {
  generatedAt: string;
  rows: AccessReviewRow[];
};

export const getAccessReview = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<AccessReview> => {
    requireSupabaseAuth(context);

    const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
      p_user_id: context.user.id,
      p_role: "super_admin",
    });
    if (roleErr) throw roleErr;
    if (isSuper !== true) {
      throw Object.assign(new Error("forbidden"), {
        statusCode: 403,
        body: JSON.stringify({ error: "forbidden" }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: profiles, error: profilesErr },
      { data: companies, error: companiesErr },
      { data: userRoles, error: rolesErr },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, company_id, created_at"),
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin.from("user_roles").select("user_id, company_id, role"),
    ]);
    if (profilesErr) throw profilesErr;
    if (companiesErr) throw companiesErr;
    if (rolesErr) throw rolesErr;

    const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
    const rolesByUser = new Map<string, string[]>();
    for (const r of userRoles ?? []) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    }

    // Last sign-in comes from the auth admin API (not exposed via PostgREST).
    const lastSignIn = new Map<string, string | null>();
    try {
      let page = 1;
      const perPage = 200;
      for (;;) {
        const { data: usersPage, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (usersErr) break;
        for (const u of usersPage.users) {
          lastSignIn.set(u.id, u.last_sign_in_at ?? null);
        }
        if (usersPage.users.length < perPage) break;
        page += 1;
        if (page > 25) break; // safety bound
      }
    } catch {
      // Best-effort — if the auth admin API is unavailable, last-login is omitted.
    }

    const rows: AccessReviewRow[] = (profiles ?? []).map((p) => ({
      userId: p.id,
      fullName: p.full_name,
      email: p.email,
      companyId: p.company_id,
      companyName: companyName.get(p.company_id) ?? null,
      roles: (rolesByUser.get(p.id) ?? []).sort(),
      lastSignInAt: lastSignIn.get(p.id) ?? null,
      createdAt: p.created_at,
    }));

    rows.sort((a, b) => (a.companyName ?? "").localeCompare(b.companyName ?? ""));

    return { generatedAt: new Date().toISOString(), rows };
  });
