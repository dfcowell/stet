# In-flight edit single-flight lock — design

**Date:** 2026-05-30
**Status:** Approved, ready for implementation planning

## Problem

Stet has no job queue. On a cache miss, `readChapter` runs the full
fetch → extract → LLM-edit → cache pipeline **synchronously inside the SSE
request handler** (`src/pipeline/index.ts`). The edit is only written to
`chapter_cache` once it completes.

This creates a duplicate-work race:

1. A user opens a chapter. Cache misses, so the LLM edit begins inside the SSE
   request. The edit takes seconds.
2. The user refreshes the page (or opens a second tab). The browser closes the
   original `EventSource` and opens a new one for the **same** `url` + profile.
3. The cache is still empty (the first edit hasn't finished), so the new request
   misses too and kicks off a **second identical LLM edit**.

Worse, Hono's `streamSSE` typically **aborts** the handler when the client
disconnects, so the original refresh-away edit may be cancelled and never
cached — meaning the refresh genuinely *has* to redo the work today.

The same race exists on the **prefetch** path: `readChapter` fires
`pipeline.prefetch(nextUrl)` in the background on a miss. If the user clicks
"next" while that prefetch edit is still in-flight, a second edit for the same
key starts.

We are a single-replica deployment, so an in-memory mechanism is sufficient.

## Goals

- Never run more than one edit at a time for a given cache key.
- A refresh / second tab / concurrent request **attaches** to the in-flight
  edit and resumes streaming (buffered output so far + live deltas after),
  rather than starting a new one.
- The edit runs to completion and is cached **even if every client
  disconnects** — decoupling the edit's lifecycle from any single SSE
  connection.
- Unify the read and prefetch paths so both go through the same
  "ensure an edit is running for this key" primitive.

## Non-goals

- No negative caching / failure cooldown / retry backoff (decision A below).
  A failed edit simply ends the stream and allows a clean retry on the next
  request.
- No cross-replica / distributed locking. Single-replica in-memory only.
- No change to the cache key, cache schema, or the SSE wire protocol.

## Design

### Overview

Introduce an in-memory **in-flight registry**, keyed by the existing cache key
`(url, profileId, promptHash, model)`. It guarantees **one producer per key**
and **fans that producer's event stream out to any number of subscribers**. The
producer runs as a **detached background task** whose lifecycle is independent
of any HTTP/SSE connection.

### Module: `src/pipeline/inflight.ts`

A factory `createInflightRegistry()` exposing two operations, keyed by string:

- **`getOrStart(key, producer)`** — if an entry exists for `key`, return its
  handle; otherwise create an entry and kick off `producer()` (typed
  `() => AsyncIterable<ReadEvent>`) as a detached background task. Returns a
  handle.
- **`handle.subscribe()`** — returns an `AsyncIterable<ReadEvent>` that first
  **replays every event buffered so far** (the `meta` event plus any `delta`s
  already emitted) and then **tails live events** until the terminal
  `done`/`error` event.

Each registry entry holds:

```
type InflightEntry = {
  events: ReadEvent[];                      // running buffer of all events emitted
  done: boolean;                            // terminal event has been emitted
  subscribers: Set<(ev: ReadEvent) => void>; // live notification callbacks
}
```

**Producer loop** (per emitted event): push the event onto `entry.events`, then
invoke every subscriber callback. When the event is terminal (`done` or
`error`): set `entry.done = true` and **remove the entry from the map**. The
producer always runs to completion regardless of whether any subscribers remain
attached.

**Subscriber** (`subscribe()`): each subscriber owns a private queue. On attach,
it synchronously snapshots the current buffer into its queue and registers its
live callback into `entry.subscribers` — these two steps happen with **no
`await` between them**, so the producer (which only emits during its own async
turns) cannot interleave, and no event is missed or duplicated. The subscriber
generator then drains its queue, awaiting when empty, and returns after it
consumes the terminal event. If the entry is already `done` at attach time, the
subscriber replays the buffer and returns without registering a live callback.

**Concurrency correctness:** Node is single-threaded and `better-sqlite3` is
**synchronous**, so the whole "cache miss → check/create in-flight entry"
decision in the pipeline runs with no `await` and is therefore atomic. There is
no time-of-check/time-of-use window.

### Pipeline integration: `src/pipeline/index.ts`

Extract the current miss-path logic into a producer function:

```
produceReadEvents(url, profile): AsyncIterable<ReadEvent>
```

This is the existing code, behavior unchanged: `loadRaw(url)` → yield `meta` →
`for await` over `editor.edit(...)` yielding `delta`s → on success `cache.put`
**then** yield terminal `done`; on failure yield terminal `error`. Writing to
the cache *before* emitting `done` ensures any request that arrives after
completion sees a clean cache hit.

`readChapter(url, opts)` becomes:

1. `resolveProfile` + `computeCacheKey` (unchanged).
2. `cache.get(key)` **hit** → yield `meta`/`delta`/`done` and return. Fast path
   is completely unchanged and never touches the registry.
3. **Miss** →
   `const handle = registry.getOrStart(key, () => produceReadEvents(url, profile));`
   then `yield* handle.subscribe();`. The first caller starts the producer; a
   refresh or concurrent caller attaches to the same one.

`prefetch(url, opts)` becomes: `resolveProfile`, `computeCacheKey`, return early
if `cache.get(key)` hits, else
`registry.getOrStart(key, () => produceReadEvents(url, profile))`
**without subscribing**. Because the producer is detached, prefetch does not
need to drain anything; a later `readChapter` for the same key attaches to the
in-flight prefetch.

The SSE handler in `src/server/app.ts` is **unchanged** — it still does
`for await (... of pipeline.readChapter(...))`. Its trailing `prefetch(nextUrl)`
call is now naturally idempotent: it either attaches to an in-flight edit or
no-ops on a cache hit, so multiple subscribers triggering it is harmless.

### Error handling (decision A)

A terminal `error` event is fanned out to all current subscribers and the entry
is dropped from the map with nothing written to the cache. The next request for
that key starts a fresh edit. No negative caching, matching today's behavior
where failed edits are never cached.

### Lifecycle / cleanup

- Entry is removed from the map the moment a terminal event is emitted.
- On `done`, `cache.put` has already run, so post-removal requests hit the
  cache.
- On `error`, nothing is cached, so post-removal requests start a fresh edit.
- The buffer is retained only for the duration of the edit (one chapter's worth
  of text) and is freed once the entry is removed and subscribers finish
  draining.

## Testing

### Registry unit tests (`src/pipeline/inflight.ts`)

- One producer runs for N concurrent subscribers; the producer's underlying work
  executes exactly once.
- A **late** subscriber (attaching after some deltas have been emitted) receives
  the full replay — `meta` plus earlier `delta`s — followed by the live tail.
- The producer runs to completion and caches **even when all subscribers detach
  early** (the refresh-abandon case).
- A terminal `error` reaches all current subscribers, and the entry is removed
  so a subsequent `getOrStart` starts a new producer.
- `getOrStart` without `subscribe` (the prefetch case) lets a later `subscribe`
  attach to the running producer rather than starting a second one.

### Pipeline integration tests (mock LLM / editor)

- Concurrent `readChapter` calls for the same key invoke `editor.edit`
  **exactly once**.
- Refresh simulation — start `readChapter`, partially consume, abandon, then
  start again before completion — also yields exactly one `editor.edit`.
- Distinct profiles produce distinct keys and therefore independent edits.
