import type { Extractor, ExtractedChapter, LlmClient, SiteAdapter } from "../types.js";
import { JSDOM } from "jsdom";
import { extractBody } from "./body.js";
import { heuristicNav } from "./nav.js";
import { detectChapterIndex } from "./chapterIndex.js";
import { chaptersFromSelect } from "./chapterSelect.js";
import { collectLinks, sameRegistrableDomain, absolute } from "./links.js";

export function createExtractor(deps: { llm?: LlmClient; model: string }): Extractor {
  return {
    async extract(args: {
      html: string;
      sourceUrl: string;
      adapter?: SiteAdapter;
    }): Promise<ExtractedChapter> {
      const { html, sourceUrl, adapter } = args;
      const doc = new JSDOM(html, { url: sourceUrl }).window.document;

      const body = extractBody(html, sourceUrl, adapter);
      // A page can be a true index (a TOC of anchor links) or a chapter that
      // merely exposes a chapter-nav <select>. Only the former sets indexUrl.
      const indexLinks = detectChapterIndex(doc, sourceUrl);
      const chapterLinks = indexLinks ?? chaptersFromSelect(doc, sourceUrl) ?? [];
      const indexUrl = indexLinks ? sourceUrl : null;

      // Adapter selector overrides for nav take precedence.
      const adapterNext = adapter?.selectors?.next
        ? absolute(doc.querySelector(adapter.selectors.next)?.getAttribute("href") ?? "", sourceUrl)
        : null;
      const adapterPrev = adapter?.selectors?.prev
        ? absolute(doc.querySelector(adapter.selectors.prev)?.getAttribute("href") ?? "", sourceUrl)
        : null;

      const heur = heuristicNav(doc, sourceUrl);
      let nextUrl = adapterNext ?? heur.nextUrl;
      const prevUrl = adapterPrev ?? heur.prevUrl;
      let navConfidence: "high" | "low" = nextUrl ? "high" : "low";

      // Constrained LLM fallback: select among REAL links only.
      if (!nextUrl && deps.llm) {
        navConfidence = "low";
        const links = collectLinks(doc, sourceUrl)
          .filter((l) => sameRegistrableDomain(l.url, sourceUrl))
          .slice(0, 40);
        if (links.length > 0) {
          const idx = await deps.llm.selectLink({
            instruction: "Select the link that leads to the NEXT chapter. Reply 'none' if no link does.",
            pageTitle: body.title,
            links,
            model: deps.model,
          });
          if (idx !== null && links[idx] && sameRegistrableDomain(links[idx]!.url, sourceUrl)) {
            nextUrl = links[idx]!.url;
          }
        }
      }

      return {
        sourceUrl,
        title: body.title,
        rawText: body.rawText,
        html: body.html,
        nextUrl,
        prevUrl,
        indexUrl,
        chapterLinks,
        navConfidence,
      };
    },
  };
}
