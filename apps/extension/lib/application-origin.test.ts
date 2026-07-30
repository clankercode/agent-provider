import { describe, expect, it } from "vitest";
import {
  contentScriptMatchPattern,
  contentScriptRegistrationId,
  isOptionalApplicationOrigin,
  isPrivateOrLocalHostname,
  optionalOriginPattern,
} from "./application-origin.js";

describe("isPrivateOrLocalHostname", () => {
  it("accepts loopback and local suffixes", () => {
    expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("::1")).toBe(true);
    expect(isPrivateOrLocalHostname("app.localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("nas.local")).toBe(true);
  });

  it("accepts RFC1918 and link-local IPv4", () => {
    expect(isPrivateOrLocalHostname("10.42.0.8")).toBe(true);
    expect(isPrivateOrLocalHostname("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalHostname("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("172.31.255.255")).toBe(true);
    expect(isPrivateOrLocalHostname("169.254.1.1")).toBe(true);
  });

  it("rejects public IPv4 and non-local names", () => {
    expect(isPrivateOrLocalHostname("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalHostname("172.15.0.1")).toBe(false);
    expect(isPrivateOrLocalHostname("172.32.0.1")).toBe(false);
    expect(isPrivateOrLocalHostname("example.com")).toBe(false);
  });
});

describe("isOptionalApplicationOrigin", () => {
  it("allows any exact HTTPS origin", () => {
    expect(isOptionalApplicationOrigin("https://app.example.com")).toBe(true);
    expect(isOptionalApplicationOrigin("https://app.example.com:8443")).toBe(
      true,
    );
  });

  it("allows private/local HTTP only", () => {
    expect(isOptionalApplicationOrigin("http://10.42.0.8:15066")).toBe(true);
    expect(isOptionalApplicationOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isOptionalApplicationOrigin("http://localhost:15067")).toBe(true);
    expect(isOptionalApplicationOrigin("http://example.com")).toBe(false);
    expect(isOptionalApplicationOrigin("http://8.8.8.8")).toBe(false);
  });

  it("rejects non-exact or non-http(s) origins", () => {
    expect(isOptionalApplicationOrigin("https://example.com/path")).toBe(
      false,
    );
    expect(isOptionalApplicationOrigin("file:///tmp")).toBe(false);
  });
});

describe("optionalOriginPattern", () => {
  it("keeps the exact origin (with port) for host permissions", () => {
    expect(optionalOriginPattern("http://10.42.0.8:15066")).toBe(
      "http://10.42.0.8:15066/*",
    );
    expect(optionalOriginPattern("https://app.example.com")).toBe(
      "https://app.example.com/*",
    );
  });

  it("throws for public HTTP", () => {
    expect(() => optionalOriginPattern("http://example.com")).toThrow(
      /private\/local/i,
    );
  });
});

describe("contentScriptMatchPattern", () => {
  it("strips ports so content-script matches are host-based", () => {
    expect(contentScriptMatchPattern("http://10.42.0.8:15066")).toBe(
      "http://10.42.0.8/*",
    );
    expect(contentScriptMatchPattern("https://app.example.com:8443")).toBe(
      "https://app.example.com/*",
    );
    expect(contentScriptMatchPattern("http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1/*",
    );
  });

  it("brackets IPv6 hostnames", () => {
    expect(contentScriptMatchPattern("http://[::1]:8080")).toBe(
      "http://[::1]/*",
    );
  });
});

describe("contentScriptRegistrationId", () => {
  it("is stable per scheme+host, ignoring port", () => {
    expect(contentScriptRegistrationId("http://10.42.0.8:15066")).toBe(
      contentScriptRegistrationId("http://10.42.0.8:9"),
    );
    expect(contentScriptRegistrationId("http://10.42.0.8:15066")).not.toBe(
      contentScriptRegistrationId("https://10.42.0.8:15066"),
    );
  });
});
