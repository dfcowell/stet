# stet Store (Cache + Library/Progress) Implementation Plan (Wave 1 — E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem lives entirely under `src/store`. Import contracts read-only from `src/types.ts` and the DB opener from `src/db/index.js`. Do NOT edit `package.json`, `src/db` (schema is owned by Foundation), or other subsystems' files.

**Goal:** Implement `ChapterCache` (edited-chapter cache + raw-extraction cache) and `LibraryStore` (followed serials + reading progress) on top of the Foundation SQLite layer.

**Architecture:** Thin row-mapping repositories over `better-sqlite3` prepared statements. `ChapterCache` reads/writes `chapter_cache` (keyed by `computeCacheKey`) and `raw_chapter` (keyed by url, profile-independent, enabling re-edit without re-fetch). `LibraryStore` reads/writes `story`, serializing `chapters[]` to `chapters_json` and flattening `progress` into columns.

**Tech Stack:** `better-sqlite3` (via `openDb` from Foundation).

**Contracts used (from `src/types.ts`):** `ChapterCache`, `ChapterCacheEntry`, `RawChapter`, `LibraryStore`, `Story`, `ChapterLink`.

---

### Task 1: ChapterCache

**Files:**
- Create: `src/store/chapterCache.ts`
- Test: `src/store/chapterCache.test.ts`

- [ ] **Step 1: Write failing test `src/store/chapterCache.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { createChapterCache } from "./chapterCache.js";
import type { ChapterCacheEntry, RawChapter } from "../types.js";

const entry = (over: Partial<ChapterCacheEntry> = {}): ChapterCacheEntry => ({
  key: "k1", url: "https://s/1", profileId: "p", promptHash: "h", model: "m",
  editedContent: "EDITED", extractedTitle: "Chapter 1",
  nextUrl: "https://s/2", prevUrl: null, rawExtractedText: "RAW", fetchedAt: 1000, ...over,
});

describe("ChapterCache edited entries", () => {
  it("round-trips put/get and returns undefined for a miss", () => {
    const cache = createChapterCache(openDb(":memory:"));
    expect(cache.get("k1")).toBeUndefined();
    cache.put(entry());
    expect(cache.get("k1")).toEqual(entry());
  });

  it("put overwrites an existing key", () => {
    const cache = createChapterCache(openDb(":memory:"));
    cache.put(entry());
    cache.put(entry({ editedContent: "EDITED2" }));
    expect(cache.get("k1")?.editedContent).toBe("EDITED2");
  });
});

describe("ChapterCache raw chapters (re-edit without re-fetch)", () => {
  it("round-trips putRaw/getRawByUrl", () => {
    const cache = createChapterCache(openDb(":memory:"));
    const raw: RawChapter = {
      url: "https://s/1", extractedTitle: "Chapter 1", rawExtractedText: "RAW",
      nextUrl: "https://s/2", prevUrl: null, indexUrl: null, fetchedAt: 1000,
    };
    expect(cache.getRawByUrl("https://s/1")).toBeUndefined();
    cache.putRaw(raw);
    expect(cache.getRawByUrl("https://s/1")).toEqual(raw);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/store/chapterCache.test.ts` → FAIL.

- [ ] **Step 3: Write `src/store/chapterCache.ts`**

```typescript
import type { Db } from "../db/index.js";
import type { ChapterCache, ChapterCacheEntry, RawChapter } from "../types.js";

interface CacheRow {
  key: string; url: string; profile_id: string; prompt_hash: string; model: string;
  edited_content: string; extracted_title: string; next_url: string | null;
  prev_url: string | null; raw_extracted_text: string; fetched_at: number;
}
interface RawRow {
  url: string; extracted_title: string; raw_extracted_text: string;
  next_url: string | null; prev_url: string | null; index_url: string | null; fetched_at: number;
}

export function createChapterCache(db: Db): ChapterCache {
  const getStmt = db.prepare<[string]>("SELECT * FROM chapter_cache WHERE key = ?");
  const putStmt = db.prepare(`
    INSERT OR REPLACE INTO chapter_cache
      (key, url, profile_id, prompt_hash, model, edited_content, extracted_title, next_url, prev_url, raw_extracted_text, fetched_at)
    VALUES (@key, @url, @profileId, @promptHash, @model, @editedContent, @extractedTitle, @nextUrl, @prevUrl, @rawExtractedText, @fetchedAt)
  `);
  const getRawStmt = db.prepare<[string]>("SELECT * FROM raw_chapter WHERE url = ?");
  const putRawStmt = db.prepare(`
    INSERT OR REPLACE INTO raw_chapter
      (url, extracted_title, raw_extracted_text, next_url, prev_url, index_url, fetched_at)
    VALUES (@url, @extractedTitle, @rawExtractedText, @nextUrl, @prevUrl, @indexUrl, @fetchedAt)
  `);

  return {
    get(key) {
      const r = getStmt.get(key) as CacheRow | undefined;
      if (!r) return undefined;
      const e: ChapterCacheEntry = {
        key: r.key, url: r.url, profileId: r.profile_id, promptHash: r.prompt_hash, model: r.model,
        editedContent: r.edited_content, extractedTitle: r.extracted_title,
        nextUrl: r.next_url, prevUrl: r.prev_url, rawExtractedText: r.raw_extracted_text, fetchedAt: r.fetched_at,
      };
      return e;
    },
    put(e) { putStmt.run(e as unknown as Record<string, unknown>); },
    getRawByUrl(url) {
      const r = getRawStmt.get(url) as RawRow | undefined;
      if (!r) return undefined;
      const raw: RawChapter = {
        url: r.url, extractedTitle: r.extracted_title, rawExtractedText: r.raw_extracted_text,
        nextUrl: r.next_url, prevUrl: r.prev_url, indexUrl: r.index_url, fetchedAt: r.fetched_at,
      };
      return raw;
    },
    putRaw(raw) { putRawStmt.run(raw as unknown as Record<string, unknown>); },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/chapterCache.ts src/store/chapterCache.test.ts
git commit -m "feat(store): add chapter cache with raw-extraction store"
```

---

### Task 2: LibraryStore

**Files:**
- Create: `src/store/libraryStore.ts`
- Test: `src/store/libraryStore.test.ts`

- [ ] **Step 1: Write failing test `src/store/libraryStore.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { createLibraryStore } from "./libraryStore.js";
import type { Story } from "../types.js";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1", title: "My Serial", sourceDomain: "s.example", indexUrl: "https://s.example/toc",
  chapters: [
    { title: "Chapter 1", url: "https://s.example/1", index: 0 },
    { title: "Chapter 2", url: "https://s.example/2", index: 1 },
  ],
  progress: { currentChapterUrl: null, lastReadAt: null }, ...over,
});

describe("LibraryStore", () => {
  it("upserts and lists stories, preserving chapters", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    expect(lib.listStories()).toEqual([]);
    lib.upsertStory(story());
    const got = lib.getStory("st1");
    expect(got?.title).toBe("My Serial");
    expect(got?.chapters).toHaveLength(2);
    expect(got?.chapters[1]).toMatchObject({ url: "https://s.example/2", index: 1 });
    expect(lib.listStories()).toHaveLength(1);
  });

  it("updates progress without disturbing chapters", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    lib.upsertStory(story());
    lib.setProgress("st1", "https://s.example/2", 1717000000000);
    const got = lib.getStory("st1");
    expect(got?.progress).toEqual({ currentChapterUrl: "https://s.example/2", lastReadAt: 1717000000000 });
    expect(got?.chapters).toHaveLength(2);
  });

  it("upsert overwrites an existing story", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    lib.upsertStory(story());
    lib.upsertStory(story({ title: "Renamed" }));
    expect(lib.getStory("st1")?.title).toBe("Renamed");
    expect(lib.listStories()).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/store/libraryStore.ts`**

```typescript
import type { Db } from "../db/index.js";
import type { LibraryStore, Story, ChapterLink } from "../types.js";

interface StoryRow {
  id: string; title: string; source_domain: string; index_url: string | null;
  chapters_json: string; current_chapter_url: string | null; last_read_at: number | null;
}

function rowToStory(r: StoryRow): Story {
  return {
    id: r.id, title: r.title, sourceDomain: r.source_domain, indexUrl: r.index_url,
    chapters: JSON.parse(r.chapters_json) as ChapterLink[],
    progress: { currentChapterUrl: r.current_chapter_url, lastReadAt: r.last_read_at },
  };
}

export function createLibraryStore(db: Db): LibraryStore {
  const listStmt = db.prepare("SELECT * FROM story ORDER BY title");
  const getStmt = db.prepare<[string]>("SELECT * FROM story WHERE id = ?");
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO story
      (id, title, source_domain, index_url, chapters_json, current_chapter_url, last_read_at)
    VALUES (@id, @title, @sourceDomain, @indexUrl, @chaptersJson, @currentChapterUrl, @lastReadAt)
  `);
  const progressStmt = db.prepare<[string, string, number]>(
    "UPDATE story SET current_chapter_url = ?, last_read_at = ? WHERE id = ?",
  );

  return {
    listStories: () => (listStmt.all() as StoryRow[]).map(rowToStory),
    getStory(id) {
      const r = getStmt.get(id) as StoryRow | undefined;
      return r ? rowToStory(r) : undefined;
    },
    upsertStory(s) {
      upsertStmt.run({
        id: s.id, title: s.title, sourceDomain: s.sourceDomain, indexUrl: s.indexUrl,
        chaptersJson: JSON.stringify(s.chapters),
        currentChapterUrl: s.progress.currentChapterUrl, lastReadAt: s.progress.lastReadAt,
      });
    },
    setProgress(storyId, currentChapterUrl, lastReadAt) {
      progressStmt.run(currentChapterUrl, lastReadAt, storyId);
    },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Run the whole store suite + typecheck**

Run: `npx vitest run src/store && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/store/libraryStore.ts src/store/libraryStore.test.ts
git commit -m "feat(store): add library and reading-progress store"
```

---

## Self-Review
1. **Spec coverage:** edited-chapter cache keyed by `(url+profileId+promptHash+model)` ✔; stores `rawExtractedText` + nav for instant revisit ✔; separate `raw_chapter` enables re-edit under a new profile without re-fetching ✔; library of followed serials ✔; reading progress + resume ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** repositories implement `ChapterCache`/`LibraryStore` from `src/types.ts`; row mappers cover every field of `ChapterCacheEntry`/`RawChapter`/`Story`; column names match the Foundation `migrations.ts` schema (`profile_id`, `prompt_hash`, `chapters_json`, `current_chapter_url`, `last_read_at`).
4. **No edits to `src/db`** (schema owned by Foundation) or `package.json`; only `src/store/**`.
