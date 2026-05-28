import type { Extractor, Fetcher, AdapterStore, Story, ChapterLink, ExtractedChapter } from "../types.js";

async function extractUrl(url: string, deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore }): Promise<ExtractedChapter> {
  const adapter = deps.adapters.forDomain(new URL(url).hostname);
  const fr = await deps.fetcher.fetch(url, adapter);
  return deps.extractor.extract({ html: fr.html, sourceUrl: fr.finalUrl, adapter });
}

export async function buildStory(
  url: string,
  deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore },
  opts: { maxChapters?: number } = {},
): Promise<Story> {
  const cap = opts.maxChapters ?? 200;
  const start = await extractUrl(url, deps);

  let ordered: ChapterLink[];
  let indexUrl: string | null = null;

  if (start.chapterLinks.length > 0) {
    ordered = start.chapterLinks;
    indexUrl = start.indexUrl;
  } else {
    // Walk back to the first chapter.
    let firstUrl = url;
    let cur = start;
    const seenBack = new Set<string>([url]);
    while (cur.prevUrl && !seenBack.has(cur.prevUrl) && seenBack.size < cap) {
      firstUrl = cur.prevUrl;
      seenBack.add(cur.prevUrl);
      cur = await extractUrl(cur.prevUrl, deps);
    }
    // Walk forward collecting the ordered list.
    const urls: { url: string; title: string }[] = [];
    let walkUrl: string | null = firstUrl;
    let node = firstUrl === url ? start : await extractUrl(firstUrl, deps);
    const seenFwd = new Set<string>();
    while (walkUrl && !seenFwd.has(walkUrl) && urls.length < cap) {
      seenFwd.add(walkUrl);
      urls.push({ url: walkUrl, title: node.title || walkUrl });
      walkUrl = node.nextUrl;
      if (walkUrl && !seenFwd.has(walkUrl)) node = await extractUrl(walkUrl, deps);
    }
    ordered = urls.map((c, i) => ({ title: c.title, url: c.url, index: i }));
  }

  const first = ordered[0]?.url ?? url;
  return {
    id: encodeURIComponent(new URL(first).hostname + new URL(first).pathname),
    title: start.title || new URL(url).hostname,
    sourceDomain: new URL(url).hostname,
    indexUrl,
    chapters: ordered,
    progress: { currentChapterUrl: first, lastReadAt: null },
  };
}
