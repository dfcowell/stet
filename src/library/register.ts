import type { Extractor, Fetcher, AdapterStore, Story } from "../types.js";

// Registers a serial from a single chapter (or index) URL with exactly ONE fetch.
// No eager prev/next walk — navigation is driven on demand by each chapter's
// nextUrl/prevUrl through the read pipeline, with one-ahead prefetch.
export async function registerSerial(
  url: string,
  deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore },
): Promise<Story> {
  const adapter = deps.adapters.forDomain(new URL(url).hostname);
  const fr = await deps.fetcher.fetch(url, adapter);
  const ex = await deps.extractor.extract({ html: fr.html, sourceUrl: fr.finalUrl, adapter });

  const isIndex = ex.chapterLinks.length > 0;
  const start = isIndex ? (ex.chapterLinks[0]?.url ?? url) : url;

  return {
    id: encodeURIComponent(new URL(url).hostname + new URL(url).pathname),
    title: ex.title || new URL(url).hostname,
    sourceDomain: new URL(url).hostname,
    // A chapter list only exists when the page is itself an index; otherwise the
    // reader navigates chapter-to-chapter via nextUrl/prevUrl.
    indexUrl: isIndex ? url : ex.indexUrl,
    chapters: ex.chapterLinks,
    progress: { currentChapterUrl: start, lastReadAt: null },
  };
}
