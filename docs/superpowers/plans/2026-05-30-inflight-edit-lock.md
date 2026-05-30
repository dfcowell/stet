# In-flight Edit Single-Flight Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that only one edit runs per cache key so a page refresh or concurrent request attaches to the in-flight edit instead of starting a duplicate LLM job.

**Architecture:** Add an in-memory in-flight registry keyed by the existing cache key. The first request for a key starts a *detached* background producer (the existing fetch→edit→cache pipeline); concurrent/refresh requests attach to it, replaying buffered events then tailing live ones. The producer runs to completion and caches even if every subscriber disconnects. The read and prefetch paths both route through the same `getOrStart` primitive.

**Tech Stack:** TypeScript, Node, Hono SSE, `better-sqlite3` (synchronous — which makes the get-or-start critical section atomic), Vitest.

**Design doc:** `docs/superpowers/specs/2026-05-30-inflight-edit-lock-design.md`

**Note on a spec refinement (prefetch):** The spec described prefetch as "start without subscribing." This plan has `prefetch` subscribe-and-drain so its returned promise still resolves once the chapter is warmed (the existing prefetch test depends on that contract, and `app.ts` calls it as `void prefetch(...)` either way). The decoupling property is preserved because the *producer* is detached — it runs to completion regardless of whether prefetch's subscription is still attached.

---

## File Structure

- **Create** `src/pipeline/inflight.ts` — the in-flight registry: one producer per key, fan-out to N subscribers. ~70 lines, single responsibility.
- **Create** `src/pipeline/inflight.test.ts` — unit tests for the registry in isolation (synthetic `ReadEvent` producers, no network/LLM).
- **Modify** `src/pipeline/index.ts` — extract the cache-miss logic into `produceReadEvents`, route `readChapter`/`prefetch` through the registry.
- **Modify** `src/pipeline/index.test.ts` — add in-flight de-duplication integration tests; existing tests must stay green unchanged.

`src/server/app.ts` is intentionally **not** modified — its `for await (... of pipeline.readChapter(...))` contract is unchanged.

---

## Task 1: In-flight registry module

**Files:**
- Create: `src/pipeline/inflight.ts`
- Test: `src/pipeline/inflight.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/inflight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createInflightRegistry } from "./inflight.js";
import type { ReadEvent } from "./index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function collect(it: AsyncIterable<ReadEvent>): Promise<ReadEvent[]> {
  const out: ReadEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const meta = (): ReadEvent => ({ type: "meta", title: "T", nextUrl: null, prevUrl: null, cached: false });

describe("createInflightRegistry", () => {
  it("runs the producer once and fans events out to concurrent subscribers", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const producer = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield meta();
      yield { type: "delta", text: "AB" };
      yield { type: "done", full: "AB" };
    };
    const h1 = reg.getOrStart("k", producer);
    const h2 = reg.getOrStart("k", producer);
    const [a, b] = await Promise.all([collect(h1.subscribe()), collect(h2.subscribe())]);
    expect(runs).toBe(1);
    expect(a).toEqual(b);
    expect(a.at(-1)).toEqual({ type: "done", full: "AB" });
  });

  it("replays buffered events to a late subscriber, then tails live events", async () => {
    const reg = createInflightRegistry();
    const reached = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta();
      yield { type: "delta", text: "early" };
      reached.resolve();
      await gate.promise;
      yield { type: "delta", text: "late" };
      yield { type: "done", full: "earlylate" };
    };
    const first = collect(reg.getOrStart("k", producer).subscribe());
    await reached.promise; // "early" is now buffered
    const second = collect(reg.getOrStart("k", producer).subscribe()); // late join
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    const texts = (evs: ReadEvent[]) => evs.filter((e) => e.type === "delta").map((e: any) => e.text);
    expect(texts(b)).toEqual(["early", "late"]);
    expect(b.find((e) => e.type === "meta")).toBeTruthy();
    expect(a).toEqual(b);
  });

  it("runs the producer to completion even if every subscriber detaches early", async () => {
    const reg = createInflightRegistry();
    const completed = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta();
      await gate.promise;
      yield { type: "done", full: "X" };
      completed.resolve();
    };
    const h = reg.getOrStart("k", producer);
    for await (const _ev of h.subscribe()) break; // take first event, then abandon
    gate.resolve();
    await completed.promise; // resolves only if the producer ran past the gate
    expect(true).toBe(true);
  });

  it("delivers a terminal error to subscribers and lets the next getOrStart restart", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const failing = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield { type: "error", message: "boom" };
    };
    const a = await collect(reg.getOrStart("k", failing).subscribe());
    expect(a.at(-1)).toEqual({ type: "error", message: "boom" });
    const b = await collect(reg.getOrStart("k", failing).subscribe());
    expect(b.at(-1)).toEqual({ type: "error", message: "boom" });
    expect(runs).toBe(2); // entry was removed after the error, so it restarts
  });

  it("starts the producer without a subscriber and lets a later subscriber attach", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const reached = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield meta();
      reached.resolve();
      await gate.promise;
      yield { type: "done", full: "Y" };
    };
    reg.getOrStart("k", producer); // no subscribe — just start it (prefetch case)
    await reached.promise;
    const sub = collect(reg.getOrStart("k", producer).subscribe());
    gate.resolve();
    const evs = await sub;
    expect(runs).toBe(1);
    expect(evs.find((e) => e.type === "meta")).toBeTruthy();
    expect(evs.at(-1)).toEqual({ type: "done", full: "Y" });
  });

  it("emits an error terminal if the producer ends without one (no hanging subscribers)", async () => {
    const reg = createInflightRegistry();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta(); // no done/error
    };
    const evs = await collect(reg.getOrStart("k", producer).subscribe());
    expect(evs.at(-1)?.type).toBe("error");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/pipeline/inflight.test.ts`
Expected: FAIL — `createInflightRegistry` cannot be imported (module does not exist yet).

- [ ] **Step 3: Implement the registry**

Create `src/pipeline/inflight.ts`:

```ts
import type { ReadEvent } from "./index.js";

/** A live subscription to an in-flight producer. */
export interface InflightHandle {
  /**
   * Replays every event buffered so far, then tails live events until the
   * terminal `done`/`error`. Independent subscriptions can be created freely.
   */
  subscribe(): AsyncIterable<ReadEvent>;
}

export interface InflightRegistry {
  /**
   * Ensure exactly one producer runs for `key`. The first caller starts
   * `producer()` as a detached background task; later callers attach to it.
   * The producer runs to completion regardless of whether anyone subscribes.
   */
  getOrStart(key: string, producer: () => AsyncIterable<ReadEvent>): InflightHandle;
}

interface Entry {
  events: ReadEvent[];
  done: boolean;
  subscribers: Set<(ev: ReadEvent) => void>;
}

function isTerminal(ev: ReadEvent): boolean {
  return ev.type === "done" || ev.type === "error";
}

export function createInflightRegistry(): InflightRegistry {
  const entries = new Map<string, Entry>();

  function emit(key: string, entry: Entry, ev: ReadEvent): void {
    entry.events.push(ev);
    if (isTerminal(ev)) {
      entry.done = true;
      entries.delete(key); // post-terminal reads hit the cache or start fresh
    }
    for (const cb of entry.subscribers) cb(ev);
  }

  async function drive(
    key: string,
    entry: Entry,
    producer: () => AsyncIterable<ReadEvent>,
  ): Promise<void> {
    try {
      for await (const ev of producer()) emit(key, entry, ev);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!entry.done) emit(key, entry, { type: "error", message });
    }
    // Defend against a producer that ends without a terminal event: subscribers
    // must never hang waiting for one.
    if (!entry.done) {
      emit(key, entry, { type: "error", message: "producer ended without a terminal event" });
    }
  }

  function subscribe(entry: Entry): AsyncIterable<ReadEvent> {
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ReadEvent> {
        // Snapshot the buffer and register the live callback synchronously, with
        // no await in between, so emit() cannot interleave: no event is missed
        // or duplicated.
        const queue: ReadEvent[] = [...entry.events];
        let wake: (() => void) | null = null;
        const cb = (ev: ReadEvent) => {
          queue.push(ev);
          if (wake) {
            const w = wake;
            wake = null;
            w();
          }
        };
        const live = !entry.done;
        if (live) entry.subscribers.add(cb);
        try {
          for (;;) {
            while (queue.length > 0) {
              const ev = queue.shift()!;
              yield ev;
              if (isTerminal(ev)) return;
            }
            if (!live) return; // already-done entry: buffer fully drained
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        } finally {
          if (live) entry.subscribers.delete(cb);
        }
      },
    };
  }

  function getOrStart(key: string, producer: () => AsyncIterable<ReadEvent>): InflightHandle {
    let entry = entries.get(key);
    if (!entry) {
      entry = { events: [], done: false, subscribers: new Set() };
      entries.set(key, entry);
      void drive(key, entry, producer);
    }
    const e = entry;
    return { subscribe: () => subscribe(e) };
  }

  return { getOrStart };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/pipeline/inflight.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `import type { ReadEvent } from "./index.js"` is erased at compile time, so there is no runtime import cycle).

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/inflight.ts src/pipeline/inflight.test.ts
git commit -m "feat(pipeline): add in-flight edit registry (single-flight + fan-out)"
```

---

## Task 2: Route the pipeline through the registry

**Files:**
- Modify: `src/pipeline/index.ts:82-156` (refactor `readChapter`, add `produceReadEvents`, refactor `prefetch`)
- Test: `src/pipeline/index.test.ts` (add a new describe block; existing tests unchanged)

- [ ] **Step 1: Write the failing integration tests**

Add a `deferred` helper near the top of `src/pipeline/index.test.ts` (after the existing imports / `collect` helper):

```ts
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
```

Append this describe block to `src/pipeline/index.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- src/pipeline/index.test.ts -t "in-flight"`
Expected: FAIL — current code starts a separate edit per read, so `edits` is `2`, not `1`.

- [ ] **Step 3: Refactor the pipeline to use the registry**

In `src/pipeline/index.ts`, add the import near the other imports at the top:

```ts
import { createInflightRegistry } from "./inflight.js";
```

Inside `createPipeline`, add the registry as the first line of the function body (immediately after `export function createPipeline(deps: PipelineDeps): Pipeline {`):

```ts
  const registry = createInflightRegistry();
```

Leave `resolveProfile` and `loadRaw` exactly as they are. Then **replace the entire `readChapter` function and the `prefetch` function** (current lines 82-156) with the following three definitions:

```ts
  // The single in-flight producer for a cache miss: fetch -> meta -> edit ->
  // cache -> done. Always ends with a terminal `done` or `error` event, and
  // writes the cache *before* emitting `done` so post-completion reads hit it.
  async function* produceReadEvents(
    url: string,
    profile: Profile,
    key: string,
  ): AsyncIterable<ReadEvent> {
    let raw: RawChapter;
    try {
      raw = await loadRaw(url);
    } catch (err) {
      let message: string;
      if (err instanceof FetchError) {
        message = `The source returned an error (HTTP ${err.status}). The chapter was not loaded.`;
      } else if (err instanceof Error && err.name === "BrowserUnavailableError") {
        message = 'This chapter needs a full browser to load, which is disabled in this deployment. Use "Open original" to read it.';
      } else {
        message = "Couldn't fetch this chapter.";
      }
      log.warn("read chapter failed", { url, error: err instanceof Error ? err.message : String(err) });
      yield { type: "error", message };
      return;
    }
    yield { type: "meta", title: raw.extractedTitle, nextUrl: raw.nextUrl, prevUrl: raw.prevUrl, cached: false };

    log.debug("editing", { url, profile: profile.id, chars: raw.rawExtractedText.length });
    let full = "";
    for await (const ev of deps.editor.edit(raw.rawExtractedText, profile)) {
      if (ev.type === "delta") {
        full += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "done") {
        full = ev.full;
      } else {
        log.warn("edit failed", { url, error: ev.message });
        yield { type: "error", message: ev.message };
        return; // failed edit is never cached as success
      }
    }

    deps.cache.put({
      key, url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
      editedContent: full, extractedTitle: raw.extractedTitle,
      nextUrl: raw.nextUrl, prevUrl: raw.prevUrl, rawExtractedText: raw.rawExtractedText,
      fetchedAt: Date.now(),
    });
    log.info("chapter ready", { url, editedChars: full.length });
    yield { type: "done", full };
  }

  async function* readChapter(url: string, opts?: { profileId?: string }): AsyncIterable<ReadEvent> {
    const profile = resolveProfile(opts?.profileId);
    const key = computeCacheKey({
      url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
    });

    const hit = deps.cache.get(key);
    if (hit) {
      log.info("read chapter", { url, profile: profile.id, cached: true });
      yield { type: "meta", title: hit.extractedTitle, nextUrl: hit.nextUrl, prevUrl: hit.prevUrl, cached: true };
      yield { type: "delta", text: hit.editedContent };
      yield { type: "done", full: hit.editedContent };
      return;
    }

    log.info("read chapter", { url, profile: profile.id, cached: false });
    // Single-flight: start the edit if none is running for this key, otherwise
    // attach to the in-flight one (the refresh / concurrent-read case).
    const handle = registry.getOrStart(key, () => produceReadEvents(url, profile, key));
    yield* handle.subscribe();
  }

  async function prefetch(url: string, opts?: { profileId?: string }): Promise<void> {
    try {
      const profile = resolveProfile(opts?.profileId);
      const key = computeCacheKey({
        url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
      });
      if (deps.cache.get(key)) return; // already warm
      log.debug("prefetch start", { url });
      // Start (or attach to) the single in-flight edit and drain it so this
      // promise resolves once the chapter is warmed. The producer is detached,
      // so the edit completes and caches even if no one stays subscribed.
      const handle = registry.getOrStart(key, () => produceReadEvents(url, profile, key));
      for await (const ev of handle.subscribe()) {
        if (ev.type === "error") return; // silent; not cached
      }
      log.debug("prefetch done", { url });
    } catch (err) {
      log.debug("prefetch failed", { url, error: err instanceof Error ? err.message : String(err) });
    }
  }
```

The `return { readChapter, prefetch };` line at the end of `createPipeline` stays unchanged.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm test -- src/pipeline/index.test.ts -t "in-flight"`
Expected: PASS — both de-duplication tests green (`edits === 1`).

- [ ] **Step 5: Run the full pipeline test file to confirm no regressions**

Run: `npm test -- src/pipeline/index.test.ts`
Expected: PASS — all existing tests (`readChapter`, `prefetch`, editor errors, non-2xx, browser-unavailable) plus the two new tests are green.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/index.ts src/pipeline/index.test.ts
git commit -m "feat(pipeline): single-flight reads/prefetch via in-flight registry"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — entire suite green, confirming nothing else (e.g. `src/server/app.test.ts`) regressed.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds with no errors.

---

## Definition of Done

- `src/pipeline/inflight.ts` exists with `createInflightRegistry`, fully unit-tested.
- `readChapter` and `prefetch` route through `registry.getOrStart`; the cache-hit fast path is unchanged.
- Concurrent reads and the refresh-abandon case provably trigger `editor.edit` exactly once.
- `npm run typecheck`, `npm test`, and `npm run build` all pass.
