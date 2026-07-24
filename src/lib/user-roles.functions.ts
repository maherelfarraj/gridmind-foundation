import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from '@/integrations/supabase/auth-attacher'

// Roles live ONLY in public.user_roles (never on profiles).
export const getCurrentUserRoles = createServerFn({ method: 'GET' })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    requireSupabaseAuth(context)
    const { data, error } = await context.supabase
      .from('user_roles')
      .select('role, company_id')
      .eq('user_id', context.user.id)
    if (error) throw error
    return data ?? []
  })

// Companies the current user belongs to (via user_roles), for the switcher.
export const listMyCompanies = createServerFn({ method: 'GET' })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    requireSupabaseAuth(context)
    const { data: roles, error: rolesErr } = await context.supabase
      .from('user_roles')
      .select('company_id')
      .eq('user_id', context.user.id)
    if (rolesErr) throw rolesErr
    const ids = Array.from(new Set((roles ?? []).map((r) => r.company_id).filter(Boolean)))
    if (ids.length === 0) return [] as { id: string; name: string }[]
    const { data: companies, error: coErr } = await context.supabase
      .from('companies')
      .select('id, name')
      .in('id', ids)
      .order('name', { ascending: true })
    if (coErr) throw coErr
    return (companies ?? []) as { id: string; name: string }[]
  })
