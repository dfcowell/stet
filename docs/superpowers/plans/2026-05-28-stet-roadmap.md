# stet — Implementation Roadmap (Plan of Plans)

**Date:** 2026-05-28
**Spec:** `docs/superpowers/specs/2026-05-28-stet-design.md`
**Status:** Active

This document locks the decomposition, the wave/parallelization strategy, and the
**shared interface contracts**. Wave-1 subsystems are implemented in parallel in
isolated git worktrees; they compile and test against the contracts below without
importing each other. If a contract must change during implementation, change it
**here first**, then in `src/types.ts`, then notify in-flight worktrees.

---

## Why waves (and why a foundation first)

Parallel worktree agents collide unless three things already exist on `main`:

1. **Shared types + component interfaces** (`src/types.ts`) — the contracts.
2. **Shared infra** they all import read-only: SQLite open/migrate (`src/db`),
   the LLM client + fake (`src/llm`), small utils (`src/util`).
3. **All dependencies installed** — so no two worktrees edit `package.json` and
   conflict on merge.

Wave 0 (Foundation) builds exactly these, on `main`. Then Wave 1 fans out.

## Conflict-avoidance rules (read before dispatching worktrees)

- **One directory per subsystem.** A worktree only creates/edits files under its
  own dir + its own test files. It never edits another subsystem's files.
- **No `package.json` edits in Wave 1.** Foundation installs every dependency up
  front. If a worktree truly needs a new dep, it stops and asks.
- **No central wiring in Wave 1.** Each subsystem exports a factory; composition
  happens in Wave 2 (`src/pipeline`, `src/server`). This keeps `src/index.ts`
  and any registry out of the parallel set.
- **Contracts are read-only in Wave 1.** `src/types.ts`, `src/db`, `src/llm`,
  `src/util` are produced by Foundation and imported, never modified, by Wave 1.

## Waves

```
Wave 0  Foundation                              (on main; sequential)
            │
   ┌────────┼────────┬─────────┬──────────┐
Wave 1  A Fetcher  B Extractor C Editor  D Config  E Store     (parallel worktrees)
   └────────┴────────┴─────────┴──────────┘
            │  (all merge to main)
Wave 2  F Pipeline+Prefetcher → G Web server+API(SSE) → H Frontend reader
```

| ID | Subsystem | Dir | Depends on | Parallel? |
|----|-----------|-----|-----------|-----------|
| 0  | Foundation | `src/{types.ts,db,llm,util}`, `test/helpers` | — | no (trunk) |
| A  | Fetcher | `src/fetcher` | 0 | yes |
| B  | Extractor | `src/extractor` | 0 | yes |
| C  | Editor | `src/editor` | 0 | yes |
| D  | Config (profiles + adapters) | `src/config` | 0 | yes |
| E  | Cache + Library/Progress store | `src/store` | 0 | yes |
| F  | Pipeline + Prefetcher | `src/pipeline` | A,B,C,D,E | no |
| G  | Web server + API (SSE) | `src/server` | F | no |
| H  | Frontend reader | `web/` | G (contract) | partial |

Each wave-1 plan is written **just-in-time** when its worktree is dispatched, so it
reflects the real merged Foundation interfaces (not guesses). Plan files:
`docs/superpowers/plans/2026-05-28-stet-<id>-<name>.md`.

---

## Shared Interface Contracts (`src/types.ts`)

These are authoritative. Foundation creates this file verbatim; Wave 1 imports from it.

```typescript
// ----- Domain -----

export interface ChapterLink {
  title: string;
  url: string;        // absolute URL
  index: number;      // position within a detected chapter-index list
}

export interface ExtractedChapter {
  sourceUrl: string;
  title: string;
  rawText: string;            // cleaned prose, paragraphs separated by "\n\n"
  html: string | null;        // Readability article HTML, if available
  nextUrl: string | null;
  prevUrl: string | null;
  indexUrl: string | null;    // chapter-index/TOC page if detected
  chapterLinks: ChapterLink[]; // populated when sourceUrl IS an index page
  navConfidence: "high" | "low"; // heuristic confidence; "low" → LLM fallback used
}

export interface Profile {
  id: string;                 // derived from config filename (sans extension)
  name: string;
  systemPrompt: string;
  model: string;              // resolved (falls back to DEFAULT_MODEL)
  maxTokens: number;          // resolved (falls back to DEFAULT_MAX_TOKENS)
  temperature: number;        // resolved (falls back to DEFAULT_TEMPERATURE)
  promptHash: string;         // sha256 over systemPrompt+model+maxTokens+temperature
}

export type GateStep =
  | { action: "click"; selector: string }
  | { action: "waitForSelector"; selector: string; timeoutMs?: number }
  | { action: "wait"; ms: number };

export interface SiteAdapter {
  domain: string;             // matched as suffix of the request hostname
  fetchMode?: "http" | "browser";
  selectors?: { body?: string; next?: string; prev?: string; index?: string };
  gateSteps?: GateStep[];
}

// ----- Persistence rows -----

export interface ChapterCacheEntry {
  key: string;                // computeCacheKey(...)
  url: string;
  profileId: string;
  promptHash: string;
  model: string;
  editedContent: string;
  extractedTitle: string;
  nextUrl: string | null;
  prevUrl: string | null;
  rawExtractedText: string;
  fetchedAt: number;          // epoch ms
}

export interface RawChapter {        // raw extraction, profile-independent
  url: string;
  extractedTitle: string;
  rawExtractedText: string;
  nextUrl: string | null;
  prevUrl: string | null;
  indexUrl: string | null;
  fetchedAt: number;
}

export interface Story {
  id: string;
  title: string;
  sourceDomain: string;
  indexUrl: string | null;
  chapters: ChapterLink[];
  progress: { currentChapterUrl: string | null; lastReadAt: number | null };
}

// ----- Infra -----

export interface FetchResult {
  html: string;
  finalUrl: string;
  status: number;
  usedBrowser: boolean;
}

export type EditEvent =
  | { type: "delta"; text: string }
  | { type: "done"; full: string }
  | { type: "error"; message: string };

// Minimal LLM surface both Editor and Extractor depend on (fakeable in tests).
export interface LlmClient {
  // Streaming edit pass. Implementation sets cache_control on `system`.
  streamEdit(args: {
    system: string;
    userText: string;
    model: string;
    maxTokens: number;
    temperature: number;
  }): AsyncIterable<string>;

  // Constrained selection: returns the index into `links`, or null if none fit.
  // The model may ONLY choose among provided links; it cannot emit a URL.
  selectLink(args: {
    instruction: string;
    pageTitle: string;
    links: ChapterLink[];
    model: string;
  }): Promise<number | null>;
}

// ----- Component interfaces (Wave 1 implements these) -----

export interface Fetcher {
  fetch(url: string, adapter?: SiteAdapter): Promise<FetchResult>;
  close(): Promise<void>;     // tears down browser if started
}

export interface Extractor {
  extract(args: {
    html: string;
    sourceUrl: string;
    adapter?: SiteAdapter;
  }): Promise<ExtractedChapter>;
}

export interface Editor {
  edit(rawText: string, profile: Profile): AsyncIterable<EditEvent>;
}

export interface ProfileStore {
  list(): Profile[];
  get(id: string): Profile | undefined;
  getActive(): Profile;
  setActive(id: string): void;
  onChange(cb: () => void): () => void; // returns unsubscribe
  close(): void;                         // stop watching
}

export interface AdapterStore {
  forDomain(hostname: string): SiteAdapter | undefined;
  onChange(cb: () => void): () => void;
  close(): void;
}

export interface ChapterCache {
  get(key: string): ChapterCacheEntry | undefined;
  put(entry: ChapterCacheEntry): void;
  getRawByUrl(url: string): RawChapter | undefined;  // for re-edit without re-fetch
  putRaw(raw: RawChapter): void;
}

export interface LibraryStore {
  listStories(): Story[];
  getStory(id: string): Story | undefined;
  upsertStory(story: Story): void;
  setProgress(storyId: string, currentChapterUrl: string, lastReadAt: number): void;
}
```

### Shared helpers (Foundation, in `src/util`)

```typescript
// src/util/hash.ts
export function sha256(input: string): string;

// src/util/cacheKey.ts
export function computeCacheKey(args: {
  url: string; profileId: string; promptHash: string; model: string;
}): string;            // = sha256(`${url}\n${profileId}\n${promptHash}\n${model}`)
```

### Defaults (Foundation, in `src/config-defaults.ts`)

```typescript
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_TEMPERATURE = 1;
```

---

## Dependency set (Foundation installs all of these)

Runtime: `@anthropic-ai/sdk`, `better-sqlite3`, `playwright`, `@mozilla/readability`,
`jsdom`, `chokidar`, `hono`, `@hono/node-server`.
(`undici`/`fetch` is built into Node 24 — no dep.)

Dev: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/better-sqlite3`,
`@types/jsdom`, `vite` (frontend, Wave 2).

> Playwright's Chromium binary (`npx playwright install chromium`) is downloaded in
> the Fetcher worktree (Wave 1 A), not in Foundation, to keep the trunk light.

---

## Testing posture (applies to every wave)

- **No live network, no real LLM, no real browser-against-internet in CI.**
- Fetcher tests run Playwright against a **local fixture HTTP server**.
- Editor/Extractor tests use the **FakeLlmClient** helper (Foundation provides it).
- Extractor tests use **saved HTML fixtures** under `test/fixtures/html/`.
- Each subsystem ships unit tests; Wave 2 adds integration tests over the composed
  pipeline with the fake LLM + fixture server.
