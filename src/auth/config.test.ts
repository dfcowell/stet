import { describe, it, expect } from "vitest";
import { parseOidcConfig } from "./config.js";

const full = {
  STET_OIDC_ISSUER: "https://idp.example",
  STET_OIDC_CLIENT_ID: "client",
  STET_OIDC_CLIENT_SECRET: "secret",
  STET_OIDC_GROUP_ID: "stet-users",
  STET_OIDC_REDIRECT_URI: "https://app.example/auth/callback",
  STET_SESSION_SECRET: "a-very-long-session-secret-value",
};

describe("parseOidcConfig", () => {
  it("returns null when no STET_OIDC_* vars are set", () => {
    expect(parseOidcConfig({})).toBeNull();
    expect(parseOidcConfig({ STET_SESSION_SECRET: "x", PORT: "8787" })).toBeNull();
  });

  it("parses a complete config with defaults", () => {
    const cfg = parseOidcConfig(full)!;
    expect(cfg).toMatchObject({
      issuer: "https://idp.example",
      clientId: "client",
      clientSecret: "secret",
      groupId: "stet-users",
      redirectUri: "https://app.example/auth/callback",
      sessionSecret: "a-very-long-session-secret-value",
      groupsClaim: "groups",
      scopes: "openid profile email groups",
      sessionTtlHours: 168,
    });
  });

  it("honors optional overrides", () => {
    const cfg = parseOidcConfig({
      ...full, STET_OIDC_GROUPS_CLAIM: "roles", STET_OIDC_SCOPES: "openid roles", STET_SESSION_TTL_HOURS: "24",
    })!;
    expect(cfg.groupsClaim).toBe("roles");
    expect(cfg.scopes).toBe("openid roles");
    expect(cfg.sessionTtlHours).toBe(24);
  });

  it("throws listing missing vars when OIDC is requested but incomplete", () => {
    expect(() => parseOidcConfig({ STET_OIDC_CLIENT_ID: "client" })).toThrow(/STET_OIDC_ISSUER/);
    expect(() => parseOidcConfig({ STET_OIDC_CLIENT_ID: "client" })).toThrow(/STET_SESSION_SECRET/);
  });
});
