/** Exact runtime principals included in this build. */
export const AGENT_PROVIDER_ALLOWED_APP_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  // Local control-plane dogfood (mesh + LAN). Exact-origin only; content
  // scripts match the host (ports cannot be encoded), and the background
  // still rejects any other origin on these hosts.
  "http://10.42.0.8:15066",
  "http://10.100.1.2:15066",
] as const;

/**
 * Narrowest browser-supported injection coverage. Firefox match patterns do
 * not encode ports, so the background worker still checks exact sender origin.
 * Host entries here cover the allowlisted dogfood origins above.
 */
export const AGENT_PROVIDER_PAGE_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "http://10.42.0.8/*",
  "http://10.100.1.2/*",
] as const;

export function isAllowedApplicationOrigin(origin: string): boolean {
  return (AGENT_PROVIDER_ALLOWED_APP_ORIGINS as readonly string[]).includes(
    origin,
  );
}
