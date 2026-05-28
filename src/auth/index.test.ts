import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAuth } from "./index.js";
import type { OidcClient } from "./oidc.js";
import type { OidcConfig } from "./config.js";

const config: OidcConfig = {
  issuer: "https://idp.example", clientId: "c", clientSecret: "s",
  groupId: "g-allowed", redirectUri: "https://app.example/auth/callback",
  sessionSecret: "test-secret", groupsClaim: "groups", scopes: "openid", sessionTtlHours: 1,
};

function fakeOidc(over: Partial<OidcClient> = {}): OidcClient {
  return {
    async createLoginRequest() { return { url: "https://idp.example/authorize?x=1", state: "st", nonce: "no", codeVerifier: "cv" }; },
    async exchange() { return { claims: { sub: "user1", groups: ["g-allowed"] } }; },
    ...over,
  };
}

function buildApp(oidc: OidcClient = fakeOidc()) {
  const auth = createAuth(config, oidc);
  const app = new Hono();
  app.use("*", auth.middleware);
  auth.registerRoutes(app);
  app.get("/api/x", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.html("<html></html>"));
  return app;
}

function cookie(res: Response, name: string): string | null {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const found = all.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(";")[0]! : null;
}

describe("gate middleware", () => {
  it("401s an unauthenticated API request", async () => {
    expect((await buildApp().request("/api/x")).status).toBe(401);
  });
  it("redirects an unauthenticated HTML navigation to /auth/login", async () => {
    const res = await buildApp().request("/", { headers: { accept: "text/html" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });
});

describe("/auth/login", () => {
  it("redirects to the provider and sets a transaction cookie", async () => {
    const res = await buildApp().request("/auth/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://idp.example/authorize?x=1");
    expect(res.headers.get("set-cookie")).toContain("stet_oidc_tx=");
  });
});

describe("/auth/callback", () => {
  it("sets a session and redirects home when the user is in the group", async () => {
    const app = buildApp();
    const login = await app.request("/auth/login");
    const cb = await app.request("/auth/callback?code=abc&state=st", { headers: { cookie: cookie(login, "stet_oidc_tx")! } });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/");
    const sess = cookie(cb, "stet_session");
    expect(sess).not.toBeNull();

    const ok = await app.request("/api/x", { headers: { cookie: sess! } });
    expect(ok.status).toBe(200);
  });

  it("403s and sets no session when the user is not in the group", async () => {
    const app = buildApp(fakeOidc({ async exchange() { return { claims: { sub: "u", groups: ["other"] } }; } }));
    const login = await app.request("/auth/login");
    const cb = await app.request("/auth/callback?code=abc&state=st", { headers: { cookie: cookie(login, "stet_oidc_tx")! } });
    expect(cb.status).toBe(403);
    expect(cookie(cb, "stet_session")).toBeNull();
  });

  it("400s without a transaction cookie", async () => {
    const cb = await buildApp().request("/auth/callback?code=abc&state=st");
    expect(cb.status).toBe(400);
  });

  it("400s when the code exchange fails", async () => {
    const app = buildApp(fakeOidc({ async exchange() { throw new Error("bad code"); } }));
    const login = await app.request("/auth/login");
    const cb = await app.request("/auth/callback?code=abc&state=st", { headers: { cookie: cookie(login, "stet_oidc_tx")! } });
    expect(cb.status).toBe(400);
  });
});
