import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { SiteAdapter } from "../types.js";

function paragraphsFrom(root: Element | Document): string {
  const blocks = Array.from(root.querySelectorAll("p, blockquote, h1, h2, h3, li"));
  const texts = blocks
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t.length > 0);
  return texts.join("\n\n");
}

export function extractBody(
  html: string,
  sourceUrl: string,
  adapter: SiteAdapter | undefined,
): { title: string; rawText: string; html: string | null } {
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;

  if (adapter?.selectors?.body) {
    const node = doc.querySelector(adapter.selectors.body);
    if (node) {
      const title = (doc.querySelector("h1")?.textContent ?? doc.title ?? "").trim();
      return { title, rawText: paragraphsFrom(node), html: node.innerHTML };
    }
  }

  // Capture the page's main heading before Readability runs; it is usually a
  // better chapter title than Readability's <title>/metadata-derived title.
  const h1 = (doc.querySelector("h1")?.textContent ?? "").trim();

  const reader = new Readability(doc);
  const article = reader.parse();
  if (article?.content) {
    const contentDoc = new JSDOM(article.content, { url: sourceUrl }).window.document;
    return {
      title: h1 || (article.title ?? "").trim(),
      rawText: paragraphsFrom(contentDoc),
      html: article.content,
    };
  }
  // Last resort: whole-body text.
  return { title: (doc.title ?? "").trim(), rawText: paragraphsFrom(doc), html: null };
}
