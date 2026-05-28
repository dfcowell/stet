import { absolute, relHints, sameRegistrableDomain } from "./links.js";

const NEXT_RE = /^(next chapter|next|forward|›|»|>|→)\s*$|next chapter|next ›|next »|next>/i;
const PREV_RE = /^(previous chapter|previous|prev|back|‹|«|<|←)\s*$|previous chapter|previous|prev «|« previous/i;

export interface HeuristicNav {
  nextUrl: string | null;
  prevUrl: string | null;
  confidence: "high" | "low";
}

function byText(doc: Document, base: string, re: RegExp): string | null {
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const text = (a.textContent ?? "").trim();
    if (!text) continue;
    if (re.test(text)) {
      const url = absolute(a.getAttribute("href") ?? "", base);
      if (url && sameRegistrableDomain(url, base)) return url.split("#")[0]!;
    }
  }
  return null;
}

export function heuristicNav(doc: Document, base: string): HeuristicNav {
  const rel = relHints(doc, base);
  const nextUrl = rel.next ?? byText(doc, base, NEXT_RE);
  const prevUrl = rel.prev ?? byText(doc, base, PREV_RE);
  return { nextUrl, prevUrl, confidence: nextUrl ? "high" : "low" };
}
