import type { ChapterLink } from "../types.js";

const MIN_SELECT_CHAPTERS = 3;

// Some sites (e.g. AO3) list every chapter in a <select> navigation dropdown
// rather than as anchors. When an option's value appears verbatim in the current
// chapter URL, that value marks the "slot" we can substitute to build each
// chapter's URL — which makes this generic across sites that use the same shape,
// while staying robust against ordinary (non-navigation) <select> elements.
export function chaptersFromSelect(doc: Document, baseUrl: string): ChapterLink[] | null {
  for (const sel of Array.from(doc.querySelectorAll("select"))) {
    const options = Array.from(sel.querySelectorAll("option")).filter(
      (o) => (o.getAttribute("value") ?? "").trim().length > 0,
    );
    if (options.length < MIN_SELECT_CHAPTERS) continue;

    const anchor = options.find((o) => baseUrl.includes(o.getAttribute("value")!.trim()));
    if (!anchor) continue;
    const anchorValue = anchor.getAttribute("value")!.trim();

    return options.map((o, i) => {
      const value = o.getAttribute("value")!.trim();
      return {
        title: (o.textContent ?? "").trim().replace(/\s+/g, " ") || `Chapter ${i + 1}`,
        url: baseUrl.replace(anchorValue, value),
        index: i,
      };
    });
  }
  return null;
}
