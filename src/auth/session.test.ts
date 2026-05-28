import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { isAuthorized, setSession, readSession, clearSession } from "./session.js";

describe("isAuthorized", () => {
  it("is true only when the group id is in the array claim", () => {
    expect(isAuthorized(["a", "b", "stet"], "stet")).toBe(true);
    expect(isAuthorized(["a", "b"], "stet")).toBe(false);
    expect(isAuthorized("stet", "stet")).toBe(false);
    expect(isAuthorized(undefined, "stet")).toBe(false);
    expect(isAuthorized([1, 2, 3], "2")).toBe(true);
  });
});

function appForSession() {
  const app = new Hono();
  const opts = { secret: "test-secret", ttlHours: 1, secure: false };
  app.get("/set", async (c) => { await setSession(c, opts, { sub: "u1", exp: Date.now() + 100_000 }); return c.text("ok"); });
  app.get("/set-expired", async (c) => { await setSession(c, opts, { sub: "u1", exp: Date.now() - 1000 }); return c.text("ok"); });
  app.get("/read", async (c) => c.json(await readSession(c, "test-secret")));
  app.get("/clear", (c) => { clearSession(c); return c.text("ok"); });
  return app;
}

function cookieFrom(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

describe("session cookie", () => {
  it("signs and reads back a valid session", async () => {
    const app = appForSession();
    const set = await app.request("/set");
    const read = await app.request("/read", { headers: { cookie: cookieFrom(set) } });
    expect(await read.json()).toMatchObject({ sub: "u1" });
  });

  it("rejects an expired session", async () => {
    const app = appForSession();
    const set = await app.request("/set-expired");
    const read = await app.request("/read", { headers: { cookie: cookieFrom(set) } });
    expect(await read.json()).toBeNull();
  });

  it("rejects a tampered/invalid cookie", async () => {
    const app = appForSession();
    const read = await app.request("/read", { headers: { cookie: "stet_session=abc.def" } });
    expect(await read.json()).toBeNull();
  });

  it("reads null when no cookie is present", async () => {
    const app = appForSession();
    const read = await app.request("/read");
    expect(await read.json()).toBeNull();
  });
});
