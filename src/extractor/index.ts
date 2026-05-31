import type { Extractor, ExtractedChapter, LlmClient, SiteAdapter, ChapterLink } from "../types.js";
import { JSDOM } from "jsdom";
import { extractBody } from "./body.js";
import { heuristicNav } from "./nav.js";
import { detectChapterIndex } from "./chapterIndex.js";
import { chaptersFromSelect } from "./chapterSelect.js";
import { collectLinks, sameRegistrableDomain, absolute } from "./links.js";
import { extractSerialTitle } from "./serialTitle.js";

function chaptersFromSelector(doc: Document, base: string, selector: string): ChapterLink[] {
  const container = doc.querySelector(selector);
  if (!container) return [];
  const out: ChapterLink[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const a of Array.from(container.querySelectorAll("a[href]"))) {
    const raw = a.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#")) continue;
    const url = absolute(raw, base);
    if (!url) continue;
    const noHash = url.split("#")[0]!;
    if (seen.has(noHash)) continue;
    seen.add(noHash);
    out.push({ title: (a.textContent ?? "").trim().slice(0, 200), url: noHash, index: i++ });
  }
  return out;
}

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

      // Chapter list resolution: adapter selector wins; otherwise a true TOC
      // (detectChapterIndex) sets indexUrl, and a chapter-nav <select> populates
      // chapters without setting indexUrl.
      const adapterListSelector = adapter?.selectors?.chapterList;
      let chapterLinks: ChapterLink[] = [];
      let indexUrl: string | null = null;
      if (adapterListSelector) {
        chapterLinks = chaptersFromSelector(doc, sourceUrl, adapterListSelector);
      }
      if (chapterLinks.length === 0) {
        const indexLinks = detectChapterIndex(doc, sourceUrl);
        chapterLinks = indexLinks ?? chaptersFromSelect(doc, sourceUrl) ?? [];
        if (indexLinks) indexUrl = sourceUrl;
      }

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

      const serialTitle = extractSerialTitle(doc, body.title, adapter?.selectors, sourceUrl);

      return {
        sourceUrl,
        title: body.title,
        serialTitle,
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
