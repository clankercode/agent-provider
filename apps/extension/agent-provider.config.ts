/** Exact runtime principals included in this build. */
export const AGENT_PROVIDER_ALLOWED_APP_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

/**
 * Narrowest browser-supported injection coverage. Firefox match patterns do
 * not encode ports, so the background worker still checks exact sender origin.
 */
export const AGENT_PROVIDER_PAGE_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
] as const;

export function isAllowedApplicationOrigin(origin: string): boolean {
  return (AGENT_PROVIDER_ALLOWED_APP_ORIGINS as readonly string[]).includes(
    origin,
  );
}
