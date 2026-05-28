import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "../../test/helpers/fixtureServer.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetcher } from "./index.js";

const rich = `<html><body>${"<p>plenty of real prose here</p>".repeat(80)}</body></html>`;
const server = await startFixtureServer({
  "/rich": { body: rich },
  "/boom": { status: 503, body: "<html><body>down</body></html>" },
});
const stateDir = mkdtempSync(join(tmpdir(), "stet-fx-"));
const fetcher = createFetcher({ stateDir });
afterAll(async () => { await fetcher.close(); await server.close(); rmSync(stateDir, { recursive: true, force: true }); });

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
});
