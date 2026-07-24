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
