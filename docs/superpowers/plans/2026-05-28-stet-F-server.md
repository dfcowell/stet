# stet Web Server + API Implementation Plan (Wave 2 — F)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem owns `src/server/`, `src/library/`, and replaces the stub `src/index.ts`. Import everything else read-only. Do NOT edit `package.json`, `src/types.ts`, foundation dirs, or any Wave-1 subsystem (`src/fetcher`, `src/extractor`, `src/editor`, `src/config`, `src/store`, `src/pipeline`) — compose them via their factory exports.

**Goal:** Implement the HTTP server (Hono + @hono/node-server) exposing the chapter SSE stream, profile, library, and progress endpoints, plus a `buildStory` library builder; and wire the real composition root in `src/index.ts`.

**Architecture:** `createApp(deps)` builds a Hono app (pure, fully unit-testable via `app.request()` with fake deps). `src/index.ts` constructs real deps (SQLite, stores, fetcher, extractor/editor backed by `AnthropicClient`, pipeline) and serves the app + the static `web/` dir. `buildStory` composes fetcher+extractor to assemble an ordered chapter list from a pasted URL.

**Tech Stack:** `hono`, `@hono/node-server` (`serve`, `serveStatic`), `hono/streaming` (`streamSSE`).

**Contracts used:** `Pipeline`/`ReadEvent` (`src/pipeline`), `ProfileStore`, `LibraryStore`, `Story`, `Fetcher`, `Extractor`, `AdapterStore`.

---

## API CONTRACT (shared verbatim with the Frontend plan — do not change unilaterally)

- `GET /api/chapter?url=<enc>&profileId=<opt>` → `text/event-stream`. One SSE message per pipeline `ReadEvent`; SSE `event:` = the event type, `data:` = JSON of the whole event object:
  - `event: meta`  `data: {"type":"meta","title":..,"nextUrl":..|null,"prevUrl":..|null,"cached":bool}`
  - `event: delta` `data: {"type":"delta","text":..}`
  - `event: done`  `data: {"type":"done","full":..}`
  - `event: error` `data: {"type":"error","message":..}`
  After `done`, the server fire-and-forget prefetches `meta.nextUrl` (bounded one-ahead).
- `GET /api/profiles` → `{"active":"<id>","profiles":[{"id","name"}]}`
- `POST /api/profiles/active` `{"id"}` → `{"active":"<id>"}` (404 if unknown id)
- `GET /api/library` → `{"stories":[{"id","title","sourceDomain","currentChapterUrl","chapterCount"}]}`
- `GET /api/story/:id` → full `Story` JSON (404 if missing)
- `POST /api/library` `{"url"}` → `{"id","title","chapters":[{"title","url","index"}]}` (builds + persists)
- `POST /api/progress` `{"storyId","url"}` → `{"ok":true}`
- `GET /` and other non-`/api` paths → static from `web/` (SPA: serve `web/index.html` as fallback).

---

### Task 1: Library builder

**Files:**
- Create: `src/library/builder.ts`
- Test: `src/library/builder.test.ts`

`buildStory` fetches the given URL, extracts it, and assembles an ordered chapter list:
if the page is itself an index (`chapterLinks` non-empty) use those; otherwise walk
`prevUrl` backward (capped) to find the first chapter, then walk `nextUrl` forward
(capped) to collect the ordered list.

- [ ] **Step 1: Write failing test `src/library/builder.test.ts`**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test/helpers/fixtureServer.js";
import { createExtractor } from "../extractor/index.js";
import { httpFetch } from "../fetcher/httpFetch.js";
import { buildStory } from "./builder.js";
import type { Fetcher } from "../types.js";

// A tiny Fetcher that only does HTTP (no browser) — sufficient for fixtures.
const httpOnlyFetcher: Fetcher = {
  async fetch(url) { const r = await httpFetch(url); return { html: r.html, finalUrl: r.finalUrl, status: r.status, usedBrowser: false }; },
  async close() {},
};

let server: FixtureServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const body = (h1: string) => `<article><h1>${h1}</h1>${"<p>Prose with enough words for readability here.</p>".repeat(40)}</article>`;

describe("buildStory", () => {
  it("walks prev/next links into an ordered chapter list", async () => {
    server = await startFixtureServer({
      "/c/1": { body: `<html><head><link rel=next href="/c/2"></head><body>${body("Chapter 1")}</body></html>` },
      "/c/2": { body: `<html><head><link rel=prev href="/c/1"><link rel=next href="/c/3"></head><body>${body("Chapter 2")}</body></html>` },
      "/c/3": { body: `<html><head><link rel=prev href="/c/2"></head><body>${body("Chapter 3")}</body></html>` },
    });
    const story = await buildStory(`${server.url}/c/2`, {
      fetcher: httpOnlyFetcher, extractor: createExtractor({ model: "m" }), adapters: { forDomain: () => undefined, onChange: () => () => {}, close: () => {} },
    }, { maxChapters: 20 });

    expect(story.chapters.map((c) => c.url)).toEqual([
      `${server.url}/c/1`, `${server.url}/c/2`, `${server.url}/c/3`,
    ]);
    expect(story.chapters[0]!.index).toBe(0);
    expect(story.sourceDomain).toBe("127.0.0.1");
    expect(story.progress.currentChapterUrl).toBe(`${server.url}/c/1`);
  });

  it("uses an index page's chapterLinks directly when present", async () => {
    const items = Array.from({ length: 6 }, (_, i) => `<a href="/c/${i + 1}">Chapter ${i + 1}</a>`).join("");
    server = await startFixtureServer({ "/toc": { body: `<html><body><ul>${items}</ul></body></html>` } });
    const story = await buildStory(`${server.url}/toc`, {
      fetcher: httpOnlyFetcher, extractor: createExtractor({ model: "m" }), adapters: { forDomain: () => undefined, onChange: () => () => {}, close: () => {} },
    }, { maxChapters: 20 });
    expect(story.chapters).toHaveLength(6);
    expect(story.indexUrl).toBe(`${server.url}/toc`);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/library/builder.test.ts` → FAIL.

- [ ] **Step 3: Write `src/library/builder.ts`**

```typescript
import type { Extractor, Fetcher, AdapterStore, Story, ChapterLink, ExtractedChapter } from "../types.js";

async function extractUrl(url: string, deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore }): Promise<ExtractedChapter> {
  const adapter = deps.adapters.forDomain(new URL(url).hostname);
  const fr = await deps.fetcher.fetch(url, adapter);
  return deps.extractor.extract({ html: fr.html, sourceUrl: fr.finalUrl, adapter });
}

export async function buildStory(
  url: string,
  deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore },
  opts: { maxChapters?: number } = {},
): Promise<Story> {
  const cap = opts.maxChapters ?? 200;
  const start = await extractUrl(url, deps);

  let ordered: ChapterLink[];
  let indexUrl: string | null = null;

  if (start.chapterLinks.length > 0) {
    ordered = start.chapterLinks;
    indexUrl = start.indexUrl;
  } else {
    // Walk back to the first chapter.
    let firstUrl = url;
    let cur = start;
    const seenBack = new Set<string>([url]);
    while (cur.prevUrl && !seenBack.has(cur.prevUrl) && seenBack.size < cap) {
      firstUrl = cur.prevUrl;
      seenBack.add(cur.prevUrl);
      cur = await extractUrl(cur.prevUrl, deps);
    }
    // Walk forward collecting the ordered list.
    const urls: { url: string; title: string }[] = [];
    let walkUrl: string | null = firstUrl;
    let node = firstUrl === url ? start : await extractUrl(firstUrl, deps);
    const seenFwd = new Set<string>();
    while (walkUrl && !seenFwd.has(walkUrl) && urls.length < cap) {
      seenFwd.add(walkUrl);
      urls.push({ url: walkUrl, title: node.title || walkUrl });
      walkUrl = node.nextUrl;
      if (walkUrl && !seenFwd.has(walkUrl)) node = await extractUrl(walkUrl, deps);
    }
    ordered = urls.map((c, i) => ({ title: c.title, url: c.url, index: i }));
  }

  const first = ordered[0]?.url ?? url;
  return {
    id: encodeURIComponent(new URL(first).hostname + new URL(first).pathname),
    title: start.title || new URL(url).hostname,
    sourceDomain: new URL(url).hostname,
    indexUrl,
    chapters: ordered,
    progress: { currentChapterUrl: first, lastReadAt: null },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/library/builder.ts src/library/builder.test.ts
git commit -m "feat(library): add serial builder via prev/next walk and index pages"
```

---

### Task 2: Hono app + routes + SSE

**Files:**
- Create: `src/server/app.ts`
- Test: `src/server/app.test.ts`

- [ ] **Step 1: Write failing test `src/server/app.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { createApp, type AppDeps } from "./app.js";
import type { Pipeline, ReadEvent, ProfileStore, LibraryStore, Story } from "../types.js";

const profile = { id: "p", name: "Light", systemPrompt: "s", model: "m", maxTokens: 10, temperature: 1, promptHash: "h" };
function fakeProfiles(): ProfileStore {
  let active = "p";
  return {
    list: () => [profile], get: (id) => (id === "p" ? profile : undefined),
    getActive: () => profile, setActive: (id) => { if (id !== "p") throw new Error("nope"); active = id; },
    onChange: () => () => {}, close: () => {},
  };
}
function fakeLibrary(stories: Story[] = []): LibraryStore {
  const map = new Map(stories.map((s) => [s.id, s]));
  return {
    listStories: () => [...map.values()], getStory: (id) => map.get(id),
    upsertStory: (s) => { map.set(s.id, s); }, setProgress: (id, url, at) => { const s = map.get(id); if (s) s.progress = { currentChapterUrl: url, lastReadAt: at }; },
  };
}
const events: ReadEvent[] = [
  { type: "meta", title: "Chapter 1", nextUrl: "https://s/2", prevUrl: null, cached: false },
  { type: "delta", text: "Hello " }, { type: "delta", text: "world" }, { type: "done", full: "Hello world" },
];
const fakePipeline: Pipeline = {
  async *readChapter() { for (const e of events) yield e; },
  async prefetch() {},
};

function app(over: Partial<AppDeps> = {}) {
  return createApp({
    pipeline: fakePipeline, profiles: fakeProfiles(), library: fakeLibrary(),
    buildStory: async (url) => ({ id: "st1", title: "Built", sourceDomain: "s", indexUrl: null, chapters: [{ title: "c1", url, index: 0 }], progress: { currentChapterUrl: url, lastReadAt: null } }),
    webDir: "web", ...over,
  });
}

describe("GET /api/chapter (SSE)", () => {
  it("streams meta, deltas, and done as SSE events", async () => {
    const res = await app().request("/api/chapter?url=" + encodeURIComponent("https://s/1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: meta");
    expect(text).toContain('"title":"Chapter 1"');
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
    expect(text).toContain('"full":"Hello world"');
  });

  it("400s without a url", async () => {
    const res = await app().request("/api/chapter");
    expect(res.status).toBe(400);
  });
});

describe("profiles + library + progress", () => {
  it("lists profiles with the active id", async () => {
    const res = await app().request("/api/profiles");
    expect(await res.json()).toEqual({ active: "p", profiles: [{ id: "p", name: "Light" }] });
  });
  it("sets the active profile and 404s unknown", async () => {
    const ok = await app().request("/api/profiles/active", { method: "POST", body: JSON.stringify({ id: "p" }), headers: { "content-type": "application/json" } });
    expect(await ok.json()).toEqual({ active: "p" });
    const bad = await app().request("/api/profiles/active", { method: "POST", body: JSON.stringify({ id: "zzz" }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(404);
  });
  it("adds a serial and lists it", async () => {
    const a = app();
    const add = await a.request("/api/library", { method: "POST", body: JSON.stringify({ url: "https://s/1" }), headers: { "content-type": "application/json" } });
    const built = await add.json();
    expect(built.id).toBe("st1");
    const list = await a.request("/api/library");
    const { stories } = await list.json();
    expect(stories).toEqual([{ id: "st1", title: "Built", sourceDomain: "s", currentChapterUrl: "https://s/1", chapterCount: 1 }]);
  });
  it("records progress", async () => {
    const lib = fakeLibrary([{ id: "st1", title: "T", sourceDomain: "s", indexUrl: null, chapters: [], progress: { currentChapterUrl: null, lastReadAt: null } }]);
    const a = app({ library: lib });
    const res = await a.request("/api/progress", { method: "POST", body: JSON.stringify({ storyId: "st1", url: "https://s/2" }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.getStory("st1")!.progress.currentChapterUrl).toBe("https://s/2");
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/server/app.test.ts` → FAIL.

- [ ] **Step 3: Write `src/server/app.ts`**

```typescript
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Pipeline, ProfileStore, LibraryStore, Story } from "../types.js";

export interface AppDeps {
  pipeline: Pipeline;
  profiles: ProfileStore;
  library: LibraryStore;
  buildStory: (url: string) => Promise<Story>;
  webDir: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/chapter", (c) => {
    const url = c.req.query("url");
    const profileId = c.req.query("profileId");
    if (!url) return c.json({ error: "url required" }, 400);
    return streamSSE(c, async (stream) => {
      let nextUrl: string | null = null;
      for await (const ev of deps.pipeline.readChapter(url, profileId ? { profileId } : undefined)) {
        if (ev.type === "meta") nextUrl = ev.nextUrl;
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
      if (nextUrl) void deps.pipeline.prefetch(nextUrl, profileId ? { profileId } : undefined);
    });
  });

  app.get("/api/profiles", (c) =>
    c.json({ active: deps.profiles.getActive().id, profiles: deps.profiles.list().map((p) => ({ id: p.id, name: p.name })) }));

  app.post("/api/profiles/active", async (c) => {
    const { id } = await c.req.json<{ id: string }>();
    try { deps.profiles.setActive(id); } catch { return c.json({ error: "unknown profile" }, 404); }
    return c.json({ active: deps.profiles.getActive().id });
  });

  app.get("/api/library", (c) =>
    c.json({ stories: deps.library.listStories().map((s) => ({
      id: s.id, title: s.title, sourceDomain: s.sourceDomain,
      currentChapterUrl: s.progress.currentChapterUrl, chapterCount: s.chapters.length,
    })) }));

  app.get("/api/story/:id", (c) => {
    const s = deps.library.getStory(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/library", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    if (!url) return c.json({ error: "url required" }, 400);
    const story = await deps.buildStory(url);
    deps.library.upsertStory(story);
    return c.json({ id: story.id, title: story.title, chapters: story.chapters });
  });

  app.post("/api/progress", async (c) => {
    const { storyId, url } = await c.req.json<{ storyId: string; url: string }>();
    deps.library.setProgress(storyId, url, Date.now());
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts src/server/app.test.ts
git commit -m "feat(server): add Hono app with chapter SSE, profiles, library, progress"
```

---

### Task 3: Composition root + static serving

**Files:**
- Create: `src/server/serve.ts`
- Modify: `src/index.ts` (replace the foundation stub)

- [ ] **Step 1: Write `src/server/serve.ts`** (adds static serving + node server start to the app)

```typescript
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function startServer(app: Hono, opts: { port: number; webDir: string }): { close: () => void } {
  // Static assets + SPA fallback for non-/api routes.
  app.use("/*", serveStatic({ root: opts.webDir }));
  app.get("/*", serveStatic({ path: `${opts.webDir}/index.html` }));
  const server = serve({ fetch: app.fetch, port: opts.port });
  return { close: () => server.close() };
}
```

- [ ] **Step 2: Replace `src/index.ts`** with the real composition root

```typescript
import { openDb } from "./db/index.js";
import { createChapterCache } from "./store/chapterCache.js";
import { createLibraryStore } from "./store/libraryStore.js";
import { createProfileStore } from "./config/profiles.js";
import { createAdapterStore } from "./config/adapters.js";
import { createFetcher } from "./fetcher/index.js";
import { createExtractor } from "./extractor/index.js";
import { createEditor } from "./editor/index.js";
import { AnthropicClient } from "./llm/anthropic.js";
import { createPipeline } from "./pipeline/index.js";
import { createApp } from "./server/app.js";
import { startServer } from "./server/serve.js";
import { buildStory } from "./library/builder.js";
import { DEFAULT_MODEL } from "./config-defaults.js";

const env = (k: string, d: string) => process.env[k] ?? d;
const configDir = env("STET_CONFIG_DIR", "./config");

const db = openDb(env("STET_DB_PATH", "./data/stet.sqlite"));
const cache = createChapterCache(db);
const library = createLibraryStore(db);
const profiles = createProfileStore({ dir: `${configDir}/profiles` });
const adapters = createAdapterStore({ dir: `${configDir}/adapters` });
const fetcher = createFetcher({ stateDir: env("STET_STATE_DIR", "./data/state") });
const llm = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
const extractor = createExtractor({ llm, model: DEFAULT_MODEL });
const editor = createEditor({ llm });
const pipeline = createPipeline({ fetcher, extractor, editor, cache, profiles, adapters });

const app = createApp({
  pipeline, profiles, library, webDir: env("STET_WEB_DIR", "./web"),
  buildStory: (url) => buildStory(url, { fetcher, extractor, adapters }),
});

const port = Number(env("PORT", "8787"));
startServer(app, { port, webDir: env("STET_WEB_DIR", "./web") });
console.log(`stet listening on http://localhost:${port}`);
```

- [ ] **Step 3: Verify build + full suite + typecheck**

Run: `npm run typecheck && npx vitest run src/server src/library && npm run build`
Expected: typecheck clean; server + library tests PASS; build emits `dist/`.

- [ ] **Step 4: Commit**

```bash
git add src/server/serve.ts src/index.ts
git commit -m "feat(server): wire composition root with static serving and node server"
```

---

## Self-Review
1. **Spec coverage:** get-chapter (SSE stream) ✔; list/add library ✔; set profile ✔; progress/resume ✔; prefetch-one-ahead kicked after `done` ✔; serves the frontend statically ✔; serial builder (prev/next walk + index) ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** routes consume `Pipeline.readChapter`/`prefetch`, `ProfileStore`, `LibraryStore` exactly; SSE event names equal `ReadEvent.type`.
4. **No package.json or shared-file edits** beyond replacing the `src/index.ts` stub; only `src/server/**`, `src/library/**`, `src/index.ts`.

> Note: `src/index.ts` is the runtime composition root and is not unit-tested (pure wiring); it is covered by `npm run build` + the orchestrator's runtime smoke test. The app logic lives in `createApp`, which is fully tested with fakes.
