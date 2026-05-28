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
