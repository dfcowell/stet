import type { ChapterLink, Story } from "../types.js";

export interface FreshMetadata {
  title: string | null;
  indexUrl: string | null;
  chapters: ChapterLink[];
}

const CHAPTER_NUMERIC_RE = /\b(chapter|ch\.?|part|episode|ep\.?|book|vol\.?|volume)\s*\d+/i;

function isNonTrivialTitle(candidate: string | null, sourceDomain: string): boolean {
  if (!candidate) return false;
  const t = candidate.trim();
  if (!t) return false;
  if (t.toLowerCase() === sourceDomain.toLowerCase()) return false;
  if (CHAPTER_NUMERIC_RE.test(t)) return false;
  return true;
}

// Opportunistic merge: applied after every chapter read so freshly extracted
// metadata progressively repairs a story row whose registration captured
// little or nothing. Rules are monotone — never throws away a known-good value
// in favor of a worse one.
export function mergeStoryMetadata(stored: Story, fresh: FreshMetadata): Story {
  const nextChapters =
    fresh.chapters.length > stored.chapters.length ? fresh.chapters : stored.chapters;
  const nextIndexUrl = stored.indexUrl ?? fresh.indexUrl;
  const nextTitle = isNonTrivialTitle(fresh.title, stored.sourceDomain)
    ? fresh.title!.trim()
    : stored.title;

  if (
    nextChapters === stored.chapters &&
    nextIndexUrl === stored.indexUrl &&
    nextTitle === stored.title
  ) {
    return stored;
  }
  return { ...stored, title: nextTitle, indexUrl: nextIndexUrl, chapters: nextChapters };
}
