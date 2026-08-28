/**
 * Best-effort client IP for rate-limit keying.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it,
 * so this is a throttling signal, never an authorization one. In production the
 * app must sit behind exactly one proxy that *replaces* the header (see
 * docs/deployment-policy.md); the left-most entry is then the real client and
 * anything an attacker prepends has been discarded upstream.
 *
 * When no forwarding header is present we fall back to a constant. That makes
 * the whole process share one bucket rather than silently rate-limiting nobody
 * — a fail-closed default that shows up immediately in dev instead of at 3am.
 */

const UNKNOWN_CLIENT = "ip:unknown";

type HeaderBag = { get(name: string): string | null };

export function clientIpFromHeaders(headers: HeaderBag): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return `ip:${first.toLowerCase()}`;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return `ip:${realIp.toLowerCase()}`;
  }

  return UNKNOWN_CLIENT;
}
