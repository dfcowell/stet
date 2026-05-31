import type { SiteAdapter } from "../types.js";

const CHAPTER_NUMERIC_RE = /\b(chapter|ch\.?|part|episode|ep\.?|book|vol\.?|volume)\s*\d+/i;
const PURE_NUMERIC_RE = /^[\d.]+$/;
const TITLE_SPLIT_RE = /\s+[-–—|]\s+|\s+::\s+/;

function isNonTrivial(s: string, chapterTitle: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t === chapterTitle.trim()) return false;
  if (CHAPTER_NUMERIC_RE.test(t)) return false;
  if (PURE_NUMERIC_RE.test(t)) return false;
  return true;
}

function metaContent(doc: Document, prop: string): string {
  const el =
    doc.querySelector(`meta[property="${prop}"]`) ?? doc.querySelector(`meta[name="${prop}"]`);
  return (el?.getAttribute("content") ?? "").trim();
}

function adapterPick(doc: Document, selector: string | undefined): string {
  if (!selector) return "";
  const el = doc.querySelector(selector);
  return (el?.textContent ?? "").trim();
}

function breadcrumbPenultimate(doc: Document): string {
  const nav = doc.querySelector(
    '[aria-label*="breadcrumb" i], nav.breadcrumb, .breadcrumb, .breadcrumbs',
  );
  if (!nav) return "";
  // Prefer leaf-like elements (a, span) so we don't double-count li>a.
  let items = Array.from(nav.querySelectorAll("a, span"))
    .map((e) => (e.textContent ?? "").trim())
    .filter(Boolean);
  if (items.length < 2) {
    items = Array.from(nav.querySelectorAll("li"))
      .map((e) => (e.textContent ?? "").trim())
      .filter(Boolean);
  }
  if (items.length < 2) return "";
  return items[items.length - 2] ?? "";
}

function titleSplit(doc: Document, chapterTitle: string): string {
  const t = (doc.title ?? "").trim();
  if (!t) return "";
  const parts = t.split(TITLE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  let best = "";
  for (const p of parts) {
    if (!isNonTrivial(p, chapterTitle)) continue;
    if (p.length > best.length) best = p;
  }
  return best;
}

function siteName(doc: Document, sourceUrl: string): string {
  const name = metaContent(doc, "og:site_name");
  if (!name) return "";
  let host = "";
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    return name;
  }
  if (name.toLowerCase() === host.toLowerCase()) return "";
  return name;
}

// Resolves a serial-level title from a single chapter page using stacked
// heuristics. Adapter selectors always win when they produce a non-empty
// element; otherwise heuristics are tried in priority order and the first
// non-trivial candidate wins. Returns null when nothing produces a usable
// title (so callers can leave existing metadata untouched).
export function extractSerialTitle(
  doc: Document,
  chapterTitle: string,
  selectors: SiteAdapter["selectors"] | undefined,
  sourceUrl: string,
): string | null {
  const adapterText = adapterPick(doc, selectors?.serialTitle);
  if (adapterText) return adapterText;

  const heuristics: string[] = [
    metaContent(doc, "og:novel:novel_name"),
    metaContent(doc, "article:series"),
    metaContent(doc, "book:series"),
    breadcrumbPenultimate(doc),
    titleSplit(doc, chapterTitle),
    siteName(doc, sourceUrl),
  ];
  for (const c of heuristics) {
    if (isNonTrivial(c, chapterTitle)) return c;
  }
  return null;
}
