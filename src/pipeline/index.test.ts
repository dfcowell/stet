import { describe, it, expect, afterEach } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test/helpers/fixtureServer.js";
import { FakeLlmClient } from "../../test/helpers/fakeLlm.js";
import { createFetcher } from "../fetcher/index.js";
import { createExtractor } from "../extractor/index.js";
import { createEditor } from "../editor/index.js";
import { createChapterCache } from "../store/chapterCache.js";
import { openDb } from "../db/index.js";
import { createPipeline, type ReadEvent } from "./index.js";
import type { Profile, ProfileStore, AdapterStore } from "../types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: "p", name: "P", systemPrompt: "edit", model: "m",
  maxTokens: 5000, temperature: 1, promptHash: "h1", ...over,
});

function profileStore(p: Profile): ProfileStore {
  return {
    list: () => [p], get: (id) => (id === p.id ? p : undefined), getActive: () => p,
    setActive: () => {}, onChange: () => () => {}, close: () => {},
  };
}
const noAdapters: AdapterStore = { forDomain: () => undefined, onChange: () => () => {}, close: () => {} };

const richBody = "<h1>Chapter One</h1>" + "<p>Real prose paragraph with plenty of words to satisfy readability.</p>".repeat(40);

function pages(server: () => string) {
  return {
    "/c/1": { body: `<html><head><link rel="next" href="/c/2"></head><body><article>${richBody}</article></body></html>` },
    "/c/2": { body: `<html><body><article><h1>Chapter Two</h1>${"<p>Second chapter prose here with words.</p>".repeat(40)}</article></body></html>` },
  };
}

async function collect(it: AsyncIterable<ReadEvent>): Promise<ReadEvent[]> {
  const out: ReadEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let server: FixtureServer | undefined;
let stateDir: string | undefined;
let fetcherClose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await fetcherClose?.();
  await server?.close();
  server = undefined;
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

function buildDeps(p: Profile) {
  stateDir = mkdtempSync(join(tmpdir(), "stet-pipe-"));
  const fetcher = createFetcher({ stateDir });
  fetcherClose = fetcher.close;
  const extractor = createExtractor({ model: "m" });
  const editor = createEditor({ llm: new FakeLlmClient({ editDeltas: ["EDITED ", "TEXT"] }) });
  const cache = createChapterCache(openDb(":memory:"));
  return { fetcher, extractor, editor, cache, profiles: profileStore(p), adapters: noAdapters };
}

describe("pipeline.readChapter", () => {
  it("on a miss: fetches, extracts, streams the edit, resolves nav, and caches", async () => {
    const deps = buildDeps(profile());
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);

    const events = await collect(pipeline.readChapter(`${server.url}/c/1`));
    const meta = events.find((e) => e.type === "meta") as Extract<ReadEvent, { type: "meta" }>;
    expect(meta.cached).toBe(false);
    expect(meta.title.toLowerCase()).toContain("chapter one");
    expect(meta.nextUrl).toBe(`${server.url}/c/2`);

    const deltas = events.filter((e) => e.type === "delta").map((e: any) => e.text).join("");
    expect(deltas).toBe("EDITED TEXT");
    const done = events.at(-1) as Extract<ReadEvent, { type: "done" }>;
    expect(done).toEqual({ type: "done", full: "EDITED TEXT" });
  });

  it("serves a second read from cache without hitting the network", async () => {
    const deps = buildDeps(profile());
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);
    const url = `${server.url}/c/1`;

    await collect(pipeline.readChapter(url)); // populate cache
    await server.close(); // network now unavailable
    server = undefined;

    const events = await collect(pipeline.readChapter(url));
    const meta = events.find((e) => e.type === "meta") as Extract<ReadEvent, { type: "meta" }>;
    expect(meta.cached).toBe(true);
    const done = events.at(-1) as Extract<ReadEvent, { type: "done" }>;
    expect(done.full).toBe("EDITED TEXT");
  });

  it("re-edits under a new profile from cached raw text without re-fetching", async () => {
    const deps = buildDeps(profile());
    server = await startFixtureServer(pages(() => server!.url));
    const url = `${server.url}/c/1`;

    const pipelineA = createPipeline(deps);
    await collect(pipelineA.readChapter(url)); // caches raw + edited under profile A
    await server.close(); // no network from here
    server = undefined;

    // Profile B shares the same fetcher/extractor/editor/cache but a different promptHash.
    const pipelineB = createPipeline({ ...deps, profiles: profileStore(profile({ id: "p2", promptHash: "h2" })) });
    const events = await collect(pipelineB.readChapter(url));
    const done = events.at(-1) as Extract<ReadEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.full).toBe("EDITED TEXT"); // re-edited from raw, no fetch error thrown
  });
});

describe("pipeline.prefetch", () => {
  it("populates the cache for one chapter ahead so the next read is instant", async () => {
    const deps = buildDeps(profile());
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);
    const nextUrl = `${server.url}/c/2`;

    await pipeline.prefetch(nextUrl);
    await server.close();
    server = undefined;

    const events = await collect(pipeline.readChapter(nextUrl));
    const meta = events.find((e) => e.type === "meta") as Extract<ReadEvent, { type: "meta" }>;
    expect(meta.cached).toBe(true);
  });

  it("never throws on prefetch failure", async () => {
    const deps = buildDeps(profile());
    const pipeline = createPipeline(deps); // no server started
    await expect(pipeline.prefetch("http://127.0.0.1:1/missing")).resolves.toBeUndefined();
  });
});

describe("pipeline editor errors", () => {
  it("surfaces an error event and does not cache the failed edit", async () => {
    const deps = buildDeps(profile());
    deps.editor = {
      async *edit() { yield { type: "error", message: "rate limit" }; },
    };
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);
    const url = `${server.url}/c/1`;

    const events = await collect(pipeline.readChapter(url));
    expect(events.at(-1)).toEqual({ type: "error", message: "rate limit" });
    // a second read still reports a miss (nothing was cached as success)
    deps.editor = { async *edit() { yield { type: "delta", text: "OK" }; yield { type: "done", full: "OK" }; } };
    const events2 = await collect(pipeline.readChapter(url));
    const meta = events2.find((e) => e.type === "meta") as Extract<ReadEvent, { type: "meta" }>;
    expect(meta.cached).toBe(false);
  });
});

describe("pipeline in-flight de-duplication", () => {
  it("edits once when two reads race for the same chapter, fanning the stream to both", async () => {
    const deps = buildDeps(profile());
    let edits = 0;
    const gate = deferred();
    deps.editor = {
      async *edit() {
        edits++;
        yield { type: "delta", text: "EDITED " };
        await gate.promise;
        yield { type: "delta", text: "TEXT" };
        yield { type: "done", full: "EDITED TEXT" };
      },
    };
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);
    const url = `${server.url}/c/1`;

    // Both reads register synchronously (cache-miss + getOrStart) before the
    // single producer's fetch resolves, so the second attaches to the first.
    const a = collect(pipeline.readChapter(url));
    const b = collect(pipeline.readChapter(url));
    gate.resolve();
    const [ea, eb] = await Promise.all([a, b]);

    expect(edits).toBe(1);
    expect((ea.at(-1) as any).full).toBe("EDITED TEXT");
    expect((eb.at(-1) as any).full).toBe("EDITED TEXT");
  });

  it("does not re-edit when a reader abandons mid-edit and a new read arrives (refresh)", async () => {
    const deps = buildDeps(profile());
    let edits = 0;
    const gate = deferred();
    deps.editor = {
      async *edit() {
        edits++;
        yield { type: "delta", text: "EDITED " };
        await gate.promise;
        yield { type: "delta", text: "TEXT" };
        yield { type: "done", full: "EDITED TEXT" };
      },
    };
    server = await startFixtureServer(pages(() => server!.url));
    const pipeline = createPipeline(deps);
    const url = `${server.url}/c/1`;

    // First read: consume until the first delta, then abandon (page refresh).
    for await (const ev of pipeline.readChapter(url)) {
      if (ev.type === "delta") break;
    }
    // Second read arrives while the edit is still gated (in-flight).
    const second = collect(pipeline.readChapter(url));
    gate.resolve();
    const evs = await second;

    expect(edits).toBe(1);
    expect((evs.at(-1) as any).full).toBe("EDITED TEXT");
  });
});

describe("pipeline non-2xx handling", () => {
  it("bails with an error and caches nothing when the source returns non-2xx", async () => {
    const deps = buildDeps(profile());
    server = await startFixtureServer({
      "/c/1": { status: 525, body: "<html><body>cloudflare ssl handshake failed</body></html>" },
    });
    const pipeline = createPipeline(deps);
    const url = `${server.url}/c/1`;

    const events = await collect(pipeline.readChapter(url));
    const last = events.at(-1) as Extract<ReadEvent, { type: "error" }>;
    expect(last.type).toBe("error");
    expect(last.message).toContain("525");
    expect(events.find((e) => e.type === "meta")).toBeUndefined();

    // nothing persisted — no raw extraction was cached
    expect(deps.cache.getRawByUrl(url)).toBeUndefined();
  });

  it("maps a browser-unavailable failure to a clear error and caches nothing", async () => {
    const deps = buildDeps(profile());
    await deps.fetcher.close();
    deps.fetcher = {
      async fetch() { const e = new Error("disabled"); e.name = "BrowserUnavailableError"; throw e; },
      async close() {},
    };
    const pipeline = createPipeline(deps);
    const events = await collect(pipeline.readChapter("https://x.example/1"));
    const last = events.at(-1) as Extract<ReadEvent, { type: "error" }>;
    expect(last.type).toBe("error");
    expect(last.message.toLowerCase()).toContain("browser");
    expect(deps.cache.getRawByUrl("https://x.example/1")).toBeUndefined();
  });
});
