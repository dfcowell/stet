import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "../../test/helpers/fixtureServer.js";
import { httpFetch } from "./httpFetch.js";

const server = await startFixtureServer({
  "/ok": { body: "<html><body><p>hello body text</p></body></html>" },
  "/redir": { status: 302, headers: { location: "/ok" } },
  "/boom": { status: 503, body: "nope" },
});
afterAll(() => server.close());

describe("httpFetch", () => {
  it("returns html, status, and finalUrl", async () => {
    const r = await httpFetch(`${server.url}/ok`);
    expect(r.status).toBe(200);
    expect(r.html).toContain("hello body text");
    expect(r.finalUrl).toBe(`${server.url}/ok`);
  });

  it("follows redirects and reports the final url", async () => {
    const r = await httpFetch(`${server.url}/redir`);
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe(`${server.url}/ok`);
  });

  it("returns the error status without throwing", async () => {
    const r = await httpFetch(`${server.url}/boom`);
    expect(r.status).toBe(503);
  });
});
