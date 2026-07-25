// P-121 IP helpers.
// SECURITY: `cf-connecting-ip` is the ONLY trusted source of client IP.
// `x-forwarded-for` is client-controllable at the edge and MUST NEVER be
// read for authz decisions. See docs/operator-env.md.
import { ipMatchesAllowlist } from './guard';

export function sourceIpFromRequest(request: Request): string | null {
  return request.headers.get('cf-connecting-ip');
}

export function isIpAllowed(ip: string | null, allowlist: string[] | null): boolean {
  return ipMatchesAllowlist(ip, allowlist);
}
