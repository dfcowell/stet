import type { Db } from "../db/index.js";
import type { ChapterCache, ChapterCacheEntry, ChapterLink, RawChapter } from "../types.js";

interface CacheRow {
  key: string; url: string; profile_id: string; prompt_hash: string; model: string;
  edited_content: string; extracted_title: string; next_url: string | null;
  prev_url: string | null; raw_extracted_text: string; fetched_at: number;
}
interface RawRow {
  url: string; extracted_title: string; raw_extracted_text: string;
  next_url: string | null; prev_url: string | null; index_url: string | null;
  chapter_links_json: string; serial_title: string | null; fetched_at: number;
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
      (url, extracted_title, raw_extracted_text, next_url, prev_url, index_url, chapter_links_json, serial_title, fetched_at)
    VALUES (@url, @extractedTitle, @rawExtractedText, @nextUrl, @prevUrl, @indexUrl, @chapterLinksJson, @serialTitle, @fetchedAt)
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
        url: r.url,
        extractedTitle: r.extracted_title,
        serialTitle: r.serial_title,
        rawExtractedText: r.raw_extracted_text,
        nextUrl: r.next_url,
        prevUrl: r.prev_url,
        indexUrl: r.index_url,
        chapterLinks: JSON.parse(r.chapter_links_json) as ChapterLink[],
        fetchedAt: r.fetched_at,
      };
      return raw;
    },
    putRaw(raw) {
      putRawStmt.run({
        url: raw.url,
        extractedTitle: raw.extractedTitle,
        rawExtractedText: raw.rawExtractedText,
        nextUrl: raw.nextUrl,
        prevUrl: raw.prevUrl,
        indexUrl: raw.indexUrl,
        chapterLinksJson: JSON.stringify(raw.chapterLinks),
        serialTitle: raw.serialTitle,
        fetchedAt: raw.fetchedAt,
      });
    },
  };
}
