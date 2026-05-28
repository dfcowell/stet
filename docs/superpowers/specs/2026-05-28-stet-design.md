# stet — Design Specification

**Date:** 2026-05-28
**Status:** Approved (brainstorming)

## Summary

**stet** is a self-hosted, single-user, mobile-first web application that turns
serialized web fiction into a clean, LLM-edited reading experience with instant
chapter navigation. For a given chapter URL it fetches the page, extracts the
chapter body and navigation links, runs a user-configurable LLM edit pass over
the prose, and renders the result in a distraction-free reader. As the user
reads, it prefetches and edits the next chapter so forward navigation is
instant.

The name *stet* is the copyediting mark meaning "let it stand" — a nod to the
editorial nature of the edit pass.

### Stack

- **Language/runtime:** TypeScript on Node.
- **LLM:** Anthropic / Claude via the official SDK, with streaming output and
  prompt caching on the (static) system prompt.
- **Browser automation:** Playwright (Chromium) for gated / JS-rendered pages.
- **Content extraction:** Mozilla Readability (with jsdom/linkedom).
- **Persistence:** SQLite.

## Goals

- Read serialized web fiction in a clean, mobile-first reader.
- Apply a user-supplied, swappable LLM edit pass to each chapter.
- Navigate chapters (next / prev / pagination, plus a slide-in chapter menu)
  with edited results appearing instantly via prefetch + cache.
- Track a library of followed serials and resume where the reader left off.

## Non-Goals (v1)

- No authentication or multi-tenant / multi-user support (single-user,
  self-hosted).
- No account sync across devices.
- No EPUB / offline export.
- Not a native mobile app — it is a mobile-first web app.

## Core Concepts

- **Target content:** serialized web fiction (chapters, next/prev,
  chapter-index pages). Extraction is tuned for this shape.
- **Editing is configurable, not hardcoded.** Behavior is driven by *profiles*
  dropped into a watched config folder. The user supplies their own system
  prompt(s).
- **Browsing re-runs the pipeline.** Clicking an extracted navigation link
  fetches, extracts, edits, and renders the target chapter through the same
  pipeline — a full cleaned reading experience within the tool.

## Architecture

### Components (server)

1. **Fetcher** — retrieves page HTML.
   - **HTTP-first** (cheap/fast) using the platform fetch / undici.
   - **Escalates to a headless browser** (Playwright/Chromium) when the page is
     JS-rendered, a gate is detected (age check / content warning / consent
     banner), or HTTP yields too little usable content.
   - Runs per-site **gate-handling steps** (e.g., click "I'm 18+" / "I
     understand") defined in a site adapter.
   - **Persists cookies / storage state** so a gate, once cleared, stays
     cleared across requests and restarts.

2. **Extractor (hybrid)** — pulls the chapter body and navigation links.
   - **Body:** Mozilla Readability (deterministic, cheap).
   - **Navigation:** heuristics first — `<link rel="next"/"prev">`, anchor
     `rel` attributes, link-text patterns ("Next Chapter", "Next", "›", "»",
     ">"), and chapter-index detection (a list of same-domain chapter links).
   - **Constrained LLM fallback:** when heuristic confidence is low, hand the
     model the list of *real* on-page links and have it *select* among them. It
     can never invent a URL.
   - **Per-site adapter override:** optional selectors for body / next / prev /
     index take precedence over heuristics.

3. **Editor** — runs the selected profile's system prompt over the extracted
   chapter via Claude.
   - **Streams** output so the reader sees text progressively.
   - Uses **prompt caching** on the static system prompt to cut cost/latency.
   - **Long-content chunking** (see below) when a chapter risks exceeding the
     input budget or, more often, the max output tokens.
   - Produces edited content for rendering.

4. **Profiles** — selectable editing profiles loaded from a **watched config
   folder** (hot-reload). Each file is a named profile (system prompt +
   optional model/params). The user picks the active profile and can switch it
   per page from the UI.

5. **Cache** — persistent on-disk store of edited chapters, keyed by
   `hash(chapterURL + profileId + promptHash + model)`. Serves instant
   revisits and backs the prefetcher. Also stores `rawExtractedText` so a
   chapter can be **re-edited under a new profile without re-fetching**.

6. **Prefetcher** — after a chapter renders, detect the next link and run
   fetch → extract → edit → cache for **exactly one** chapter ahead. Never more
   than one, to bound token cost. Failures are silent and never block the
   foreground read.

7. **Library / progress store** — persists followed serials and reading
   progress (current chapter per story, last-read timestamp). Enables
   resume-where-you-left-off.

8. **Web server + API** — serves the frontend and exposes endpoints (get
   chapter, list/add library, set profile, navigation). **Streams edited
   content to the reader via SSE.**

9. **Frontend** — mobile-first **immersive reader**:
   - Centered single reading column, comfortable typography.
   - Thin top bar: chapter-menu toggle + active-profile selector.
   - Progress strip.
   - Prev / next controls.
   - **Slide-in chapter menu** (used when the site provides a chapter list).
   - A library / add-serial view to follow and resume serials.

### Data Model (SQLite)

- **Story** — `id`, `title`, `sourceDomain`, `indexUrl?` (TOC if known),
  `chapters[]` (ordered `{title, url, index}`), `progress`
  (`currentChapterUrl`, `lastReadAt`).
- **ChapterCacheEntry** — `key = hash(url + profileId + promptHash + model)`,
  `editedContent`, `extractedTitle`, `nextUrl?`, `prevUrl?`,
  `rawExtractedText`, `fetchedAt`.
- **Profile** — `id`, `name`, `systemPrompt`, optional `model`/params; loaded
  from the watched folder; `promptHash` derived for cache keying.
- **SiteAdapter (optional)** — `domain`, `fetchMode` (http/browser), content /
  next / prev / index `selectors`, `gateSteps[]` (clicks/waits to clear gates).
  Hot-reloaded from config.

## Data Flow

### Reading a chapter

1. User opens a chapter — from library/resume, or by pasting a new URL.
2. **Cache hit** on `(url + active profile)` → serve instantly.
3. **Miss** → Fetcher (HTTP, escalate to browser if gated) → Extractor (body +
   nav) → Editor (stream via Claude) → render progressively while writing the
   result to cache.
4. On render complete → update progress; **Prefetcher** runs the next chapter
   in the background (if not already cached), bounded to one ahead.
5. User taps **Next** → usually a prefetched cache hit → instant; then prefetch
   the *new* next chapter.

### Switching profiles

Changing the active profile re-keys the cache. If `rawExtractedText` is cached,
the chapter is **re-edited without re-fetching** — no extra network/browser
work and no need to re-clear gates; just a fresh LLM pass.

### Adding a serial to the library

Paste any chapter URL → extraction walks prev-links (or the chapter index, if
found) to build the ordered chapter list and title → store as a Story. Resume
later from saved progress.

## Long-Content Chunking

A single fiction chapter rarely exceeds Claude's input context, but a long
chapter rewritten roughly 1:1 can exceed the **max output tokens**, and some
serials post very long single pages.

- Estimate tokens; if the chapter risks exceeding the input budget or the max
  output tokens, **split at paragraph / section boundaries** into ordered
  chunks (never cut mid-sentence).
- Run the profile's edit prompt **per chunk**, **stream** each chunk as it
  lands, then **stitch in order** and cache the stitched result.
- **Optional context-carry** (previous chunk's tail or a short running style
  note) to keep names/voice consistent across chunks — configurable and **off
  by default** to stay cheap and simple.

## Error Handling

- **Fetch failures** (network / 403 / Cloudflare): retry with backoff →
  escalate to browser → if still failing, surface a clear error with an "open
  original" link.
- **Gate not auto-clearable:** detect and inform the user; per-site `gateSteps`
  handle known cases; offer "open original to clear it, then retry" with cookie
  reuse.
- **Weak extraction / no nav:** render what we got with a notice; allow manual
  next/prev URL entry; offer the LLM nav fallback explicitly.
- **LLM errors / rate limits:** retry with backoff; stream partial output; on
  hard failure, show the **un-edited extracted text** with a banner rather than
  nothing.
- **Hallucination guard:** the nav LLM fallback may only *select* among real
  on-page links; validate plausibility (e.g., same-origin-ish).
- **Prefetch failures:** silent and logged; never block the foreground read;
  failures are not cached as success.
- **Prompt edits invalidate cache** naturally via `promptHash` in the cache
  key.

## Testing

- **Unit:** extractor heuristics against saved HTML fixtures from
  representative fiction sites; nav / chapter-index detection;
  cache-key/promptHash; profile + adapter hot-reload; chunk splitter
  (boundaries/threshold) + stitcher.
- **Integration:** full pipeline with a **mocked Anthropic client** + fixture
  HTML; prefetch-one-ahead behavior; resume/progress; profile re-edit from
  `rawExtractedText` (no re-fetch).
- **Browser automation:** smoke-test `gateSteps` against a local fixture page
  with a content-warning button (Playwright against a local server).
- **CI hygiene:** no live sites or real LLM calls in CI — fixtures + a fake
  LLM. Optional flagged manual "live" checks.

## Open Questions / Deferred

- Specific token thresholds for triggering chunking (tune empirically).
- Exact chapter-index walking strategy for building a Story (prev-link walk vs.
  TOC parse) may need per-site refinement.
- Whether to add EPUB export or multi-device sync in a later version.
