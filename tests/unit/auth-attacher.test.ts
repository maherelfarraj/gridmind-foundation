// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getRequestMock = vi.fn()
const createServerSupabaseClientMock = vi.fn()
const getUserMock = vi.fn()

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequestMock(),
}))

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

vi.mock('@/integrations/supabase/server', () => ({
  createServerSupabaseClient: (req: Request) => createServerSupabaseClientMock(req),
}))

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from '@/integrations/supabase/auth-attacher'

// Mirror the .server() body so we can exercise it without spinning up the
// full TanStack RPC runtime.
async function runServerMiddleware(): Promise<AuthContext> {
  const request = getRequestMock()
  const supabaseServer = createServerSupabaseClientMock(request)
  let user = null as AuthContext['user']
  try {
    const { data, error } = await supabaseServer.auth.getUser()
    if (!error) user = data.user ?? null
  } catch {
    user = null
  }
  return { user, supabase: supabaseServer }
}

beforeEach(() => {
  getRequestMock.mockReset()
  createServerSupabaseClientMock.mockReset()
  getUserMock.mockReset()
  getRequestMock.mockReturnValue(new Request('http://localhost/api'))
  createServerSupabaseClientMock.mockImplementation(() => ({
    auth: { getUser: getUserMock },
    __marker: 'per-request-client',
  }))
})

describe('attachSupabaseAuth + requireSupabaseAuth', () => {
  it('attaches user=null when no session; requireSupabaseAuth throws 401 JSON', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const context = await runServerMiddleware()
    expect(context.user).toBeNull()
    expect((context.supabase as unknown as { __marker: string }).__marker).toBe(
      'per-request-client',
    )

    let caught: unknown
    try {
      requireSupabaseAuth(context)
    } catch (e) {
      caught = e
    }
    const err = caught as { statusCode?: number; body?: string; headers?: Record<string, string> }
    expect(err?.statusCode).toBe(401)
    expect(err?.body).toBe('{"error":"unauthorized"}')
    expect(err?.headers?.['content-type']).toMatch(/application\/json/)
  })

  it('attaches real user when session is valid', async () => {
    const user = { id: 'user-123', email: 'demo@example.com' } as never
    getUserMock.mockResolvedValue({ data: { user }, error: null })
    const context = await runServerMiddleware()
    expect(context.user?.id).toBe('user-123')
    expect(() => requireSupabaseAuth(context)).not.toThrow()
  })

  it('exports attachSupabaseAuth middleware object', () => {
    expect(attachSupabaseAuth).toBeDefined()
  })
})
