/**
 * Exact-origin eligibility for optional page bridges.
 *
 * HTTPS application origins are always eligible (user still grants one exact
 * origin via the browser permission prompt). HTTP is limited to private /
 * local hosts so public cleartext sites cannot become optional bridge targets.
 *
 * Browser constraints (important for integrators):
 * - Host *permissions* may include an exact origin with port
 *   (`http://10.42.0.8:15066/*`).
 * - Content-script *match patterns* cannot reliably encode ports the same way
 *   (Firefox never can; Chromium match patterns are host-based). Registration
 *   therefore uses a host-wide pattern (`http://10.42.0.8/*`) and the
 *   background worker re-checks the exact sender origin against the user's
 *   enabled-origin list.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** True for loopback, link-local, RFC1918, ULA, and common local suffixes. */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (v4) {
    const octets = v4.slice(1).map((part) => Number(part));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6: loopback already handled; unique-local fc00::/7; link-local fe80::/10
  if (host.includes(":")) {
    if (host === "0:0:0:0:0:0:0:1") return true;
    const compact = host.replace(/^0+/u, "0");
    if (compact.startsWith("fc") || compact.startsWith("fd")) return true;
    if (
      compact.startsWith("fe8") ||
      compact.startsWith("fe9") ||
      compact.startsWith("fea") ||
      compact.startsWith("feb")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Whether this exact origin may be enabled as an optional application bridge.
 * Build-time allowlisted origins bypass this and are always active.
 */
export function isOptionalApplicationOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return isPrivateOrLocalHostname(url.hostname);
  }
  return false;
}

/**
 * Match pattern for `permissions.request` / `permissions.contains`.
 * Keeps the exact origin (including non-default port) so the browser grant
 * stays as narrow as the permission API allows.
 */
export function optionalOriginPattern(origin: string): string {
  if (!isOptionalApplicationOrigin(origin)) {
    throw new Error(
      "Only exact HTTPS origins, or HTTP on private/local hosts, can be enabled.",
    );
  }
  return `${origin}/*`;
}

/**
 * Host-level match pattern for `scripting.registerContentScripts`.
 * Ports are omitted: content-script match patterns are host-based. Exact-port
 * authority is enforced again in the background from sender origin.
 */
export function contentScriptMatchPattern(origin: string): string {
  if (!isOptionalApplicationOrigin(origin)) {
    throw new Error(
      "Only exact HTTPS origins, or HTTP on private/local hosts, can be enabled.",
    );
  }
  const url = new URL(origin);
  // URL.hostname may already be bracketed for IPv6 depending on runtime.
  const bare = stripIpv6Brackets(url.hostname);
  const host = bare.includes(":") ? `[${bare}]` : bare;
  return `${url.protocol}//${host}/*`;
}

/** Stable content-script id keyed by scheme+host (not port). */
export function contentScriptRegistrationId(origin: string): string {
  const url = new URL(origin);
  const host = url.hostname.toLowerCase();
  const scheme = url.protocol.replace(":", "");
  // Keep ids short and chrome-safe (alphanumeric + hyphen).
  const raw = `${scheme}-${host}`.replace(/[^a-z0-9.-]+/giu, "-");
  return `agent-provider-host-${raw}`.slice(0, 80);
}
