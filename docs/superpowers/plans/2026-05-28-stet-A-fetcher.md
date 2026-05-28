# stet Fetcher Implementation Plan (Wave 1 — A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem lives entirely under `src/fetcher`. Do NOT edit files outside it (except your own tests). Import contracts read-only from `src/types.ts`; use `test/helpers/fixtureServer.ts` for tests. Do NOT edit `package.json`.

**Goal:** Implement the `Fetcher` — HTTP-first retrieval that escalates to a headless browser (Playwright/Chromium) when a page is JS-rendered, gated, or content-thin, runs per-site `gateSteps`, and persists cookies/storage so a cleared gate stays cleared.

**Architecture:** `createFetcher()` returns a `Fetcher`. It tries `httpFetch` first; an `escalation` decision function inspects the HTTP result (status, byte size, gate markers) and the adapter to decide whether to fall back to `browserFetch`. The browser path loads persisted `storageState` per domain, runs `gateSteps`, captures rendered HTML, and saves storage back. Browser is lazily launched and reused; `close()` tears it down.

**Tech Stack:** Node 24 built-in `fetch`, Playwright (Chromium), `better-sqlite3` not needed here.

**Contracts used (from `src/types.ts`):** `Fetcher`, `FetchResult`, `SiteAdapter`, `GateStep`.

---

### Task 1: Install Chromium for Playwright

- [ ] **Step 1:** Run `npx playwright install chromium`
Expected: downloads the Chromium build. (Playwright npm package is already installed by Foundation.)

- [ ] **Step 2: Commit** (no code yet; this records nothing — skip commit, proceed to Task 2.)

---

### Task 2: HTTP fetch

**Files:**
- Create: `src/fetcher/httpFetch.ts`
- Test: `src/fetcher/httpFetch.test.ts`

- [ ] **Step 1: Write failing test `src/fetcher/httpFetch.test.ts`**

```typescript
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
```

- [ ] **Step 2:** Run `npx vitest run src/fetcher/httpFetch.test.ts` → FAIL (no module).

- [ ] **Step 3: Write `src/fetcher/httpFetch.ts`**

```typescript
export interface HttpResult {
  html: string;
  finalUrl: string;
  status: number;
}

export async function httpFetch(url: string, timeoutMs = 15000): Promise<HttpResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; stet/0.1; +https://localhost) AppleWebKit/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();
    return { html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 4:** Run the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/httpFetch.ts src/fetcher/httpFetch.test.ts
git commit -m "feat(fetcher): add http-first fetch"
```

---

### Task 3: Escalation decision (pure function)

**Files:**
- Create: `src/fetcher/escalation.ts`
- Test: `src/fetcher/escalation.test.ts`

- [ ] **Step 1: Write failing test `src/fetcher/escalation.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { shouldEscalate, GATE_MARKERS } from "./escalation.js";

describe("shouldEscalate", () => {
  it("escalates when adapter forces browser mode", () => {
    expect(shouldEscalate({ status: 200, html: "x".repeat(5000) }, { domain: "d", fetchMode: "browser" })).toBe(true);
  });
  it("escalates on too-thin body", () => {
    expect(shouldEscalate({ status: 200, html: "<html></html>" }, undefined)).toBe(true);
  });
  it("escalates when a gate marker is present", () => {
    const html = `<html><body>${GATE_MARKERS[0]}</body></html>`;
    expect(shouldEscalate({ status: 200, html }, undefined)).toBe(true);
  });
  it("escalates on 403", () => {
    expect(shouldEscalate({ status: 403, html: "x".repeat(5000) }, undefined)).toBe(true);
  });
  it("does NOT escalate for a healthy content-rich 200", () => {
    const html = `<html><body>${"<p>real prose here</p>".repeat(80)}</body></html>`;
    expect(shouldEscalate({ status: 200, html }, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/fetcher/escalation.ts`**

```typescript
import type { SiteAdapter } from "../types.js";

// Substrings that strongly indicate an interstitial gate/consent wall.
export const GATE_MARKERS = [
  "Are you 18 or older",
  "I am over 18",
  "Verify your age",
  "content warning",
  "Checking your browser before",
  "Enable JavaScript and cookies to continue",
  "cf-browser-verification",
];

const MIN_USABLE_BYTES = 1024;

export function shouldEscalate(
  http: { status: number; html: string },
  adapter: SiteAdapter | undefined,
): boolean {
  if (adapter?.fetchMode === "browser") return true;
  if (adapter?.fetchMode === "http") return false;
  if (http.status === 403 || http.status === 429 || http.status >= 500) return true;
  if (http.html.length < MIN_USABLE_BYTES) return true;
  const lower = http.html.toLowerCase();
  if (GATE_MARKERS.some((m) => lower.includes(m.toLowerCase()))) return true;
  return false;
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/escalation.ts src/fetcher/escalation.test.ts
git commit -m "feat(fetcher): add browser-escalation decision"
```

---

### Task 4: Storage-state persistence

**Files:**
- Create: `src/fetcher/storageState.ts`
- Test: `src/fetcher/storageState.test.ts`

- [ ] **Step 1: Write failing test `src/fetcher/storageState.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStorageState, saveStorageState } from "./storageState.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "stet-ss-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("storageState", () => {
  it("returns undefined when none saved", () => {
    expect(loadStorageState(dir, "example.com")).toBeUndefined();
  });
  it("round-trips per-domain state", () => {
    const state = { cookies: [{ name: "a", value: "1" }], origins: [] };
    saveStorageState(dir, "example.com", state);
    expect(loadStorageState(dir, "example.com")).toEqual(state);
    // different domain is isolated
    expect(loadStorageState(dir, "other.com")).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/fetcher/storageState.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function fileFor(dir: string, domain: string): string {
  const safe = domain.replace(/[^a-z0-9.-]/gi, "_");
  return join(dir, `${safe}.json`);
}

export function loadStorageState(dir: string, domain: string): unknown | undefined {
  const f = fileFor(dir, domain);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, "utf8"));
}

export function saveStorageState(dir: string, domain: string, state: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(dir, domain), JSON.stringify(state), "utf8");
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/storageState.ts src/fetcher/storageState.test.ts
git commit -m "feat(fetcher): persist per-domain browser storage state"
```

---

### Task 5: Browser fetch with gate steps

**Files:**
- Create: `src/fetcher/browserFetch.ts`
- Test: `src/fetcher/browserFetch.test.ts`

- [ ] **Step 1: Write failing test `src/fetcher/browserFetch.test.ts`**

This serves a page whose real content is hidden until an "I'm 18+" button is clicked; `gateSteps` must click it.

```typescript
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
```

- [ ] **Step 2:** Run `npx vitest run src/fetcher/browserFetch.test.ts` → FAIL.

- [ ] **Step 3: Write `src/fetcher/browserFetch.ts`**

```typescript
import type { Browser } from "playwright";
import type { SiteAdapter } from "../types.js";
import { loadStorageState, saveStorageState } from "./storageState.js";

export interface BrowserResult {
  html: string;
  finalUrl: string;
  status: number;
}

export async function browserFetch(
  browser: Browser,
  url: string,
  adapter: SiteAdapter | undefined,
  stateDir: string,
): Promise<BrowserResult> {
  const domain = adapter?.domain ?? new URL(url).hostname;
  const storageState = loadStorageState(stateDir, domain) as any;
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    for (const step of adapter?.gateSteps ?? []) {
      if (step.action === "click") {
        await page.click(step.selector, { timeout: 10000 }).catch(() => {});
      } else if (step.action === "waitForSelector") {
        await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? 10000 }).catch(() => {});
      } else if (step.action === "wait") {
        await page.waitForTimeout(step.ms);
      }
    }
    const html = await page.content();
    saveStorageState(stateDir, domain, await context.storageState());
    return { html, finalUrl: page.url(), status: resp?.status() ?? 200 };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/browserFetch.ts src/fetcher/browserFetch.test.ts
git commit -m "feat(fetcher): add playwright browser fetch with gate steps"
```

---

### Task 6: Fetcher factory (compose http → escalate → browser)

**Files:**
- Create: `src/fetcher/index.ts`
- Test: `src/fetcher/index.test.ts`

- [ ] **Step 1: Write failing test `src/fetcher/index.test.ts`**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "../../test/helpers/fixtureServer.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetcher } from "./index.js";

const rich = `<html><body>${"<p>plenty of real prose here</p>".repeat(80)}</body></html>`;
const server = await startFixtureServer({ "/rich": { body: rich } });
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
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/fetcher/index.ts`**

```typescript
import { chromium, type Browser } from "playwright";
import type { Fetcher, FetchResult, SiteAdapter } from "../types.js";
import { httpFetch } from "./httpFetch.js";
import { shouldEscalate } from "./escalation.js";
import { browserFetch } from "./browserFetch.js";

export function createFetcher(opts: { stateDir: string }): Fetcher {
  let browser: Browser | undefined;

  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }

  return {
    async fetch(url: string, adapter?: SiteAdapter): Promise<FetchResult> {
      const http = await httpFetch(url);
      if (!shouldEscalate({ status: http.status, html: http.html }, adapter)) {
        return { html: http.html, finalUrl: http.finalUrl, status: http.status, usedBrowser: false };
      }
      const b = await getBrowser();
      const res = await browserFetch(b, url, adapter, opts.stateDir);
      return { html: res.html, finalUrl: res.finalUrl, status: res.status, usedBrowser: true };
    },
    async close(): Promise<void> {
      await browser?.close();
      browser = undefined;
    },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Run the whole fetcher suite**

Run: `npx vitest run src/fetcher && npm run typecheck`
Expected: all fetcher tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/fetcher/index.ts src/fetcher/index.test.ts
git commit -m "feat(fetcher): compose http-first fetch with browser escalation"
```

---

## Self-Review
1. **Spec coverage:** HTTP-first ✔, browser escalation (JS/gate/thin/403) ✔, per-site gateSteps ✔, cookie/storage persistence across requests ✔, `Fetcher` interface (`fetch`/`close`) ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** returns `FetchResult` exactly (`html/finalUrl/status/usedBrowser`); `GateStep` actions handled match the union in `src/types.ts`.
4. **No package.json edits**; only `src/fetcher/**` + the chromium binary install.
