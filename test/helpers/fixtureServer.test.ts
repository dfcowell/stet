import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "./fixtureServer.js";

const server = await startFixtureServer({
  "/chapter-1": { body: "<html><body><h1>One</h1></body></html>" },
  "/redir": { status: 302, headers: { location: "/chapter-1" } },
});
afterAll(() => server.close());

describe("startFixtureServer", () => {
  it("serves a fixture route and exposes a base url", async () => {
    const res = await fetch(`${server.url}/chapter-1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>One</h1>");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${server.url}/missing`);
    expect(res.status).toBe(404);
  });
});
