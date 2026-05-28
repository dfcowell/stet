import type { ChapterLink } from "../types.js";
import { collectLinks, sameRegistrableDomain } from "./links.js";

const CHAPTER_TEXT_RE = /\b(chapter|ch\.?|part|episode|ep\.?)\s*\d+/i;
const MIN_CHAPTERS = 5;

export function detectChapterIndex(doc: Document, base: string): ChapterLink[] | null {
  const candidates = collectLinks(doc, base).filter(
    (l) => sameRegistrableDomain(l.url, base) && CHAPTER_TEXT_RE.test(l.title),
  );
  if (candidates.length < MIN_CHAPTERS) return null;
  return candidates.map((l, i) => ({ ...l, index: i }));
}
