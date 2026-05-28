import type { Extractor, Fetcher, AdapterStore, Story } from "../types.js";
import { log, withSpan } from "../obs/index.js";

// Registers a serial from a single chapter (or index) URL with exactly ONE fetch.
// No eager prev/next walk — navigation is driven on demand by each chapter's
// nextUrl/prevUrl through the read pipeline, with one-ahead prefetch.
export async function registerSerial(
  url: string,
  deps: { fetcher: Fetcher; extractor: Extractor; adapters: AdapterStore },
): Promise<Story> {
  return withSpan(
    "register_serial",
    async () => {
      const adapter = deps.adapters.forDomain(new URL(url).hostname);
      const fr = await deps.fetcher.fetch(url, adapter);
      const ex = await deps.extractor.extract({ html: fr.html, sourceUrl: fr.finalUrl, adapter });

      const isIndex = ex.chapterLinks.length > 0;
      const start = isIndex ? (ex.chapterLinks[0]?.url ?? url) : url;

      const story: Story = {
        id: encodeURIComponent(new URL(url).hostname + new URL(url).pathname),
        title: ex.title || new URL(url).hostname,
        sourceDomain: new URL(url).hostname,
        // A chapter list only exists when the page is itself an index; otherwise
        // the reader navigates chapter-to-chapter via nextUrl/prevUrl.
        indexUrl: isIndex ? url : ex.indexUrl,
        chapters: ex.chapterLinks,
        progress: { currentChapterUrl: start, lastReadAt: null },
      };
      log.info("registered serial", { url, title: story.title, chapters: story.chapters.length });
      return story;
    },
    { url },
  );
}
