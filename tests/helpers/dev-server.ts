// Shared helper: api/rls/e2e suites self-skip when the dev server is unreachable.
// Unit tests NEVER use this — they must run offline and always execute.
export const DEV_SERVER_URL = 'http://localhost:8080';

export async function isDevServerUp(url = DEV_SERVER_URL): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(1_500),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

// Usage in every tests/api|rls|e2e file:
//   import { isDevServerUp } from '../helpers/dev-server';
//   const serverUp = await isDevServerUp();
//   describe.skipIf(!serverUp)('API guard matrix', () => { ... });
