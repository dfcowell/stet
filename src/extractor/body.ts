import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { SiteAdapter } from "../types.js";

// Containers that hold site chrome rather than the article itself.
const CHROME_SELECTOR =
  "header, nav, footer, aside, [role=banner], [role=navigation], #header, .header, .masthead";

function paragraphsFrom(root: Element | Document): string {
  const blocks = Array.from(root.querySelectorAll("p, blockquote, h1, h2, h3, li"));
  const texts = blocks
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t.length > 0);
  return texts.join("\n\n");
}

function metaContent(doc: Document, prop: string): string {
  const el =
    doc.querySelector(`meta[property="${prop}"]`) ?? doc.querySelector(`meta[name="${prop}"]`);
  return (el?.getAttribute("content") ?? "").trim();
}

// First heading that belongs to the content, skipping site banners and
// accessibility landmark/hidden headings (e.g. AO3's "Work Header" landmark and
// its top-of-page site-name <h1>).
function contentHeading(doc: Document): string {
  for (const h of Array.from(doc.querySelectorAll("h1, h2, h3"))) {
    if (h.closest(CHROME_SELECTOR)) continue;
    if (/\blandmark\b/.test(h.getAttribute("class") ?? "")) continue;
    if (h.getAttribute("aria-hidden") === "true" || h.hasAttribute("hidden")) continue;
    const text = (h.textContent ?? "").trim().replace(/\s+/g, " ");
    if (text) return text;
  }
  return "";
}

export function extractBody(
  html: string,
  sourceUrl: string,
  adapter: SiteAdapter | undefined,
): { title: string; rawText: string; html: string | null } {
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;

  // Resolve the title from the original DOM. Adapter override wins; otherwise
  // og:title is the strongest signal, then the first non-chrome content
  // heading. Computed before Readability runs, since Readability.parse()
  // mutates the document.
  const adapterTitle = adapter?.selectors?.chapterTitle
    ? (doc.querySelector(adapter.selectors.chapterTitle)?.textContent ?? "").trim()
    : "";
  const preTitle = adapterTitle || metaContent(doc, "og:title") || contentHeading(doc);
  const docTitle = (doc.title ?? "").trim();

  if (adapter?.selectors?.body) {
    const node = doc.querySelector(adapter.selectors.body);
    if (node) {
      return { title: preTitle || docTitle, rawText: paragraphsFrom(node), html: node.innerHTML };
    }
  }

  const reader = new Readability(doc);
  const article = reader.parse();
  if (article?.content) {
    const contentDoc = new JSDOM(article.content, { url: sourceUrl }).window.document;
    return {
      title: preTitle || (article.title ?? "").trim() || docTitle,
      rawText: paragraphsFrom(contentDoc),
      html: article.content,
    };
  }
  // Last resort: whole-body text.
  return { title: preTitle || docTitle, rawText: paragraphsFrom(doc), html: null };
}
