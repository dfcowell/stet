# stet Extractor Implementation Plan (Wave 1 — B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem lives entirely under `src/extractor`. Import contracts read-only from `src/types.ts`; in tests, build a `FakeLlmClient` from `test/helpers/fakeLlm.ts`. Do NOT edit `package.json` or other subsystems' files.

**Goal:** Implement the `Extractor` — Readability body extraction plus navigation discovery (rel links, link-text heuristics, chapter-index detection), with a **constrained LLM fallback** that may only *select among real on-page links* (never invent a URL), and per-site adapter selector overrides.

**Architecture:** `createExtractor({ llm, model })` returns an `Extractor`. `extract()` runs: (1) body via Readability (or adapter `body` selector), (2) collect all real on-page links (absolute-resolved) + `<link rel>` hints, (3) heuristic next/prev/index, (4) if next is unresolved and `llm` is set, call `llm.selectLink` over the real link list and validate the choice is same-registrable-domain. `navConfidence` is `"high"` when heuristics resolved next, else `"low"`.

**Tech Stack:** `@mozilla/readability`, `jsdom`.

**Contracts used (from `src/types.ts`):** `Extractor`, `ExtractedChapter`, `ChapterLink`, `SiteAdapter`, `LlmClient`.

---

### Task 1: Link collection + URL helpers

**Files:**
- Create: `src/extractor/links.ts`
- Test: `src/extractor/links.test.ts`

- [ ] **Step 1: Write failing test `src/extractor/links.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { collectLinks, sameRegistrableDomain, relHints } from "./links.js";

const html = `<!doctype html><html><head>
  <link rel="next" href="/c/2"><link rel="prev" href="/c/0">
  </head><body>
  <a href="/c/2">Next Chapter ›</a>
  <a href="https://other.example/x">Offsite</a>
  <a href="/c/0">Previous</a>
  <a href="#top">Top</a>
</body></html>`;

const doc = new JSDOM(html, { url: "https://site.example/c/1" }).window.document;

describe("collectLinks", () => {
  it("resolves to absolute urls and drops empty/hash-only", () => {
    const links = collectLinks(doc, "https://site.example/c/1");
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://site.example/c/2");
    expect(urls).toContain("https://other.example/x");
    expect(urls).not.toContain("https://site.example/c/1#top");
  });
});

describe("relHints", () => {
  it("reads <link rel=next/prev> and a[rel]", () => {
    const h = relHints(doc, "https://site.example/c/1");
    expect(h.next).toBe("https://site.example/c/2");
    expect(h.prev).toBe("https://site.example/c/0");
  });
});

describe("sameRegistrableDomain", () => {
  it("treats subdomains of the same site as same", () => {
    expect(sameRegistrableDomain("https://www.site.example/a", "https://site.example/b")).toBe(true);
    expect(sameRegistrableDomain("https://other.example/a", "https://site.example/b")).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/extractor/links.test.ts` → FAIL.

- [ ] **Step 3: Write `src/extractor/links.ts`**

```typescript
import type { ChapterLink } from "../types.js";

export function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function collectLinks(doc: Document, base: string): ChapterLink[] {
  const out: ChapterLink[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const raw = a.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#")) continue;
    const url = absolute(raw, base);
    if (!url) continue;
    const noHash = url.split("#")[0]!;
    if (noHash === base.split("#")[0]) continue; // self
    if (seen.has(noHash)) continue;
    seen.add(noHash);
    out.push({ title: (a.textContent ?? "").trim().slice(0, 200), url: noHash, index: i++ });
  }
  return out;
}

export function relHints(doc: Document, base: string): { next: string | null; prev: string | null } {
  const pick = (rel: string): string | null => {
    const link = doc.querySelector(`link[rel~="${rel}"]`) ?? doc.querySelector(`a[rel~="${rel}"]`);
    const href = link?.getAttribute("href");
    return href ? absolute(href, base) : null;
  };
  return { next: pick("next"), prev: pick("prev") };
}

export function registrableDomain(host: string): string {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

export function sameRegistrableDomain(a: string, b: string): boolean {
  try {
    return registrableDomain(new URL(a).hostname) === registrableDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extractor/links.ts src/extractor/links.test.ts
git commit -m "feat(extractor): add link collection and url helpers"
```

---

### Task 2: Navigation heuristics

**Files:**
- Create: `src/extractor/nav.ts`
- Test: `src/extractor/nav.test.ts`

- [ ] **Step 1: Write failing test `src/extractor/nav.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { heuristicNav } from "./nav.js";

function nav(html: string, url = "https://s.example/c/5") {
  const doc = new JSDOM(html, { url }).window.document;
  return heuristicNav(doc, url);
}

describe("heuristicNav", () => {
  it("prefers rel=next/prev link tags (high confidence)", () => {
    const r = nav(`<head><link rel=next href="/c/6"><link rel=prev href="/c/4"></head><body></body>`);
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.prevUrl).toBe("https://s.example/c/4");
    expect(r.confidence).toBe("high");
  });

  it("falls back to link-text patterns", () => {
    const r = nav(`<body><a href="/c/6">Next Chapter »</a><a href="/c/4">« Previous</a></body>`);
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.prevUrl).toBe("https://s.example/c/4");
    expect(r.confidence).toBe("high");
  });

  it("reports low confidence when no next is found", () => {
    const r = nav(`<body><a href="/about">About</a></body>`);
    expect(r.nextUrl).toBeNull();
    expect(r.confidence).toBe("low");
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/extractor/nav.ts`**

```typescript
import { absolute, relHints, sameRegistrableDomain } from "./links.js";

const NEXT_RE = /^(next chapter|next|forward|›|»|>|→)\s*$|next chapter|next ›|next »|next>/i;
const PREV_RE = /^(previous chapter|previous|prev|back|‹|«|<|←)\s*$|previous chapter|prev «/i;

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
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extractor/nav.ts src/extractor/nav.test.ts
git commit -m "feat(extractor): add navigation heuristics"
```

---

### Task 3: Chapter-index detection

**Files:**
- Create: `src/extractor/chapterIndex.ts`
- Test: `src/extractor/chapterIndex.test.ts`

- [ ] **Step 1: Write failing test `src/extractor/chapterIndex.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { detectChapterIndex } from "./chapterIndex.js";

describe("detectChapterIndex", () => {
  it("returns an ordered list when many same-domain chapter links exist", () => {
    const items = Array.from({ length: 8 }, (_, i) => `<a href="/story/ch-${i + 1}">Chapter ${i + 1}</a>`).join("");
    const doc = new JSDOM(`<body><ul>${items}</ul></body>`, { url: "https://s.example/toc" }).window.document;
    const links = detectChapterIndex(doc, "https://s.example/toc");
    expect(links).not.toBeNull();
    expect(links!.length).toBe(8);
    expect(links![0]).toMatchObject({ url: "https://s.example/story/ch-1", index: 0 });
  });

  it("returns null when there is no chapter-like list", () => {
    const doc = new JSDOM(`<body><a href="/a">A</a><a href="/b">B</a></body>`, { url: "https://s.example/p" }).window.document;
    expect(detectChapterIndex(doc, "https://s.example/p")).toBeNull();
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/extractor/chapterIndex.ts`**

```typescript
import type { ChapterLink } from "../types.js";
import { collectLinks, sameRegistrableDomain } from "./links.js";

const CHAPTER_TEXT_RE = /\b(chapter|ch\.?|part|episode|ep\.?)\s*\d+/i;
const MIN_CHAPTERS = 5;

export function detectChapterIndex(doc: Document, base: string): ChapterLink[] | null {
  const candidates = collectLinks(doc, base).filter(
    (l) => sameRegistrableDomain(l.url, base) && CHAPTER_TEXT_RE.test(l.title),
  );
  if (candidates.length < MIN_CHAPTERS) return null;
  return candidates.map((l, i) => ({ ...l, index: i }));
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extractor/chapterIndex.ts src/extractor/chapterIndex.test.ts
git commit -m "feat(extractor): add chapter-index detection"
```

---

### Task 4: Body extraction (Readability + adapter override)

**Files:**
- Create: `src/extractor/body.ts`
- Test: `src/extractor/body.test.ts`

- [ ] **Step 1: Write failing test `src/extractor/body.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { extractBody } from "./body.js";

const article = `<!doctype html><html><head><title>Site</title></head><body>
  <nav>menu junk</nav>
  <article><h1>Chapter Five</h1>
    <p>First paragraph of real prose that is reasonably long for Readability.</p>
    <p>Second paragraph continues the scene with more words and detail here.</p>
  </article></body></html>`;

describe("extractBody", () => {
  it("pulls title and paragraphs joined by blank lines", () => {
    const r = extractBody(article, "https://s.example/c/5", undefined);
    expect(r.title.toLowerCase()).toContain("chapter five");
    expect(r.rawText).toContain("First paragraph");
    expect(r.rawText).toContain("\n\n");
    expect(r.rawText).not.toContain("menu junk");
  });

  it("honors an adapter body selector", () => {
    const html = `<body><div class="content"><p>Selected prose paragraph one here.</p><p>And two.</p></div><div>ignore me</div></body>`;
    const r = extractBody(html, "https://s.example/c/5", { domain: "s.example", selectors: { body: ".content" } });
    expect(r.rawText).toContain("Selected prose");
    expect(r.rawText).not.toContain("ignore me");
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/extractor/body.ts`**

```typescript
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

  const reader = new Readability(doc);
  const article = reader.parse();
  if (article?.content) {
    const contentDoc = new JSDOM(article.content, { url: sourceUrl }).window.document;
    return {
      title: (article.title ?? "").trim(),
      rawText: paragraphsFrom(contentDoc),
      html: article.content,
    };
  }
  // Last resort: whole-body text.
  return { title: (doc.title ?? "").trim(), rawText: paragraphsFrom(doc), html: null };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extractor/body.ts src/extractor/body.test.ts
git commit -m "feat(extractor): add readability body extraction with adapter override"
```

---

### Task 5: Extractor factory (compose body + nav + index + constrained LLM fallback)

**Files:**
- Create: `src/extractor/index.ts`
- Test: `src/extractor/index.test.ts`

- [ ] **Step 1: Write failing test `src/extractor/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { createExtractor } from "./index.js";
import { FakeLlmClient } from "../../test/helpers/fakeLlm.js";

const base = "https://s.example/c/5";
const richBody = `<article><h1>Chapter Five</h1>${"<p>Real prose paragraph with enough words.</p>".repeat(6)}</article>`;

describe("createExtractor", () => {
  it("resolves nav via heuristics with high confidence (no LLM call)", async () => {
    const llm = new FakeLlmClient({ selectIndex: 0 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<head><link rel=next href="/c/6"></head><body><a href="/c/6">Next ›</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.navConfidence).toBe("high");
    expect(llm.lastSelectArgs).toBeUndefined(); // fallback not used
  });

  it("uses constrained LLM fallback when heuristics fail, selecting a real link only", async () => {
    // The model 'picks' index 1, which maps to /c/6 — a real on-page link.
    const llm = new FakeLlmClient({ selectIndex: 1 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<body><a href="/random">Random</a><a href="/c/6">Continue reading</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.navConfidence).toBe("low");
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(llm.lastSelectArgs).toBeDefined();
  });

  it("rejects an LLM choice that is off-domain (hallucination/plausibility guard)", async () => {
    const llm = new FakeLlmClient({ selectIndex: 0 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<body><a href="https://evil.example/x">Continue</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.nextUrl).toBeNull();
  });

  it("populates chapterLinks for an index page", async () => {
    const ex = createExtractor({ model: "m" }); // no llm needed
    const items = Array.from({ length: 6 }, (_, i) => `<a href="/c/${i + 1}">Chapter ${i + 1}</a>`).join("");
    const r = await ex.extract({ html: `<body><ul>${items}</ul></body>`, sourceUrl: "https://s.example/toc" });
    expect(r.chapterLinks.length).toBe(6);
    expect(r.indexUrl).toBe("https://s.example/toc");
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/extractor/index.ts`**

```typescript
import type { Extractor, ExtractedChapter, LlmClient, SiteAdapter } from "../types.js";
import { JSDOM } from "jsdom";
import { extractBody } from "./body.js";
import { heuristicNav } from "./nav.js";
import { detectChapterIndex } from "./chapterIndex.js";
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
      const chapterLinks = detectChapterIndex(doc, sourceUrl) ?? [];
      const indexUrl = chapterLinks.length > 0 ? sourceUrl : null;

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
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Run the whole extractor suite + typecheck**

Run: `npx vitest run src/extractor && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/extractor/index.ts src/extractor/index.test.ts
git commit -m "feat(extractor): compose body, nav, index, and constrained llm fallback"
```

---

## Self-Review
1. **Spec coverage:** Readability body ✔; rel/next-prev + link-text heuristics ✔; chapter-index detection ✔; constrained LLM fallback that *selects real links only* ✔; same-domain plausibility/hallucination guard ✔; adapter selector overrides (body/next/prev) ✔; `navConfidence` set ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** returns `ExtractedChapter` with every field from `src/types.ts`; uses `LlmClient.selectLink` exactly as declared (returns index | null).
4. **No package.json edits**; only `src/extractor/**`.

> Note: `indexUrl` is set only when the *current* page is itself an index. Discovering a separate TOC URL for an arbitrary chapter page is deferred to the Library-build flow (Wave 2 / Store), per the spec's open question on index-walking.
