import { describe, it, expect, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixtureServer } from "../../test/helpers/fixtureServer.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserFetch } from "./browserFetch.js";

const gatePage = `<!doctype html><html><body>
  <div id="gate">Are you 18 or older?
    <button id="ok" onclick="document.getElementById('content').style.display='block';document.getElementById('gate').remove()">I am over 18</button>
  </div>
  <article id="content" style="display:none"><p>The secret chapter text.</p></article>
</body></html>`;

const server = await startFixtureServer({ "/gated": { body: gatePage } });
let browser: Browser;
const stateDir = mkdtempSync(join(tmpdir(), "stet-bf-"));
afterAll(async () => { await browser?.close(); await server.close(); rmSync(stateDir, { recursive: true, force: true }); });

describe("browserFetch", () => {
  it("runs gateSteps and returns post-gate rendered html", async () => {
    browser = await chromium.launch();
    const r = await browserFetch(browser, `${server.url}/gated`, {
      domain: "127.0.0.1",
      gateSteps: [
        { action: "click", selector: "#ok" },
        { action: "waitForSelector", selector: "#content" },
      ],
    }, stateDir);
    expect(r.html).toContain("The secret chapter text.");
    expect(r.status).toBe(200);
  });
});
