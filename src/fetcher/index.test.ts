import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "../../test/helpers/fixtureServer.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetcher, BrowserUnavailableError } from "./index.js";

const rich = `<html><body>${"<p>plenty of real prose here</p>".repeat(80)}</body></html>`;
const server = await startFixtureServer({
  "/rich": { body: rich },
  "/boom": { status: 503, body: "<html><body>down</body></html>" },
  "/gated": { body: "<html><body>Enable JavaScript and cookies to continue</body></html>" },
});
const stateDir = mkdtempSync(join(tmpdir(), "stet-fx-"));
const fetcher = createFetcher({ stateDir });
const slimFetcher = createFetcher({ stateDir, browserDisabled: true });
afterAll(async () => { await fetcher.close(); await slimFetcher.close(); await server.close(); rmSync(stateDir, { recursive: true, force: true }); });

describe("createFetcher", () => {
  it("serves content-rich pages over HTTP without launching a browser", async () => {
    const r = await fetcher.fetch(`${server.url}/rich`);
    expect(r.usedBrowser).toBe(false);
    expect(r.html).toContain("real prose");
    expect(r.status).toBe(200);
  });

  it("does not escalate to the browser on a non-2xx response", async () => {
    const r = await fetcher.fetch(`${server.url}/boom`);
    expect(r.usedBrowser).toBe(false);
    expect(r.status).toBe(503);
  });

  it("throws BrowserUnavailableError when a page needs the browser but it is disabled", async () => {
    await expect(slimFetcher.fetch(`${server.url}/gated`)).rejects.toBeInstanceOf(BrowserUnavailableError);
  });

  it("still serves HTTP-only pages when the browser is disabled", async () => {
    const r = await slimFetcher.fetch(`${server.url}/rich`);
    expect(r.usedBrowser).toBe(false);
    expect(r.status).toBe(200);
  });
});
