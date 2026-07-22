import { describe, expect, it } from "vitest";
import { authorizeGrant, createAuthorityGrant } from "./grants.js";

const fingerprint = "a".repeat(64);
const request = {
  origin: "https://app.example",
  alias: "default",
  aliasFingerprint: fingerprint,
  baseMode: "standard" as const,
  tabId: 7,
  clientId: "client-1",
  sessionId: "session-1",
  now: 200,
};

describe("authority grants", () => {
  it("binds origin, alias fingerprint, mode, session scope, and expiry", () => {
    const grant = createAuthorityGrant({
      id: "grant-1",
      origin: request.origin,
      aliasFingerprints: { default: fingerprint },
      baseMode: "standard",
      scope: {
        kind: "session",
        tabId: 7,
        clientId: "client-1",
        sessionId: "session-1",
      },
      grantedAt: 100,
      expiresAt: 300,
    });
    expect(authorizeGrant(grant, request)).toEqual({ ok: true });
    expect(
      authorizeGrant(grant, { ...request, origin: "https://other.example" }),
    ).toEqual({ ok: false, reason: "origin" });
    expect(
      authorizeGrant(grant, { ...request, aliasFingerprint: "b".repeat(64) }),
    ).toEqual({ ok: false, reason: "fingerprint" });
    expect(authorizeGrant(grant, { ...request, tabId: 8 })).toEqual({
      ok: false,
      reason: "scope",
    });
    expect(authorizeGrant(grant, { ...request, now: 300 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("allows tightening standard to audit-first but not the reverse", () => {
    const common = {
      origin: request.origin,
      aliasFingerprints: { default: fingerprint },
      scope: { kind: "persistent" as const },
      grantedAt: 100,
      expiresAt: 300,
    };
    expect(
      authorizeGrant(
        createAuthorityGrant({ ...common, baseMode: "standard" }),
        {
          ...request,
          baseMode: "audit-first",
        },
      ),
    ).toEqual({ ok: true });
    expect(
      authorizeGrant(
        createAuthorityGrant({ ...common, baseMode: "audit-first" }),
        request,
      ),
    ).toEqual({ ok: false, reason: "mode" });
  });
});
