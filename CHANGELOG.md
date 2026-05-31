# Changelog

All notable changes to **stet** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-05-31

### Added

- **Installable PWA.** The reader can be added to the home screen and launches
  without browser chrome — `apple-mobile-web-app-capable=yes`, a real 180×180
  apple-touch-icon, and a `manifest.webmanifest` are now part of the served
  bundle.
- **Opportunistic serial metadata refresh.** Every successful chapter read now
  re-extracts serial-level metadata (title, full chapter list, index URL) from
  the page and merges it into the stored library row. A serial whose
  registration captured a junk title or an empty chapter list — for example
  because the first fetch returned a 5xx error page — repairs itself the first
  time any of its chapters is successfully read. No manual "refresh" button or
  registration retry is required.
- **`serialTitle` extractor.** Stacked heuristics pull a serial-level title
  from `og:novel:novel_name`, `article:series` / `book:series`, a breadcrumb's
  penultimate item, the non-chapter portion of `<title>`, and `og:site_name`
  (rejected when it merely echoes the hostname).
- **Site-adapter overrides for difficult sites.** `selectors.serialTitle`,
  `selectors.chapterTitle`, and `selectors.chapterList` join the existing
  `body` / `next` / `prev` / `index` overrides; adapter selectors always win
  over heuristics. Adapter JSON files in `config/adapters/` pick up the new
  fields with no schema change.

### Reader UX

- Chapter menu and serial title in the reader refresh after a chapter finishes
  streaming so newly-discovered chapters appear without a page reload.

### Schema

- `raw_chapter` migration v2 adds `chapter_links_json` (default `'[]'`) and
  `serial_title` (nullable). Existing rows backfill cleanly.

## [0.1.1] — 2026-05-30

### Fixed

- A page refresh (or a second tab) during an in-progress edit no longer starts a
  duplicate edit. Reads are now single-flight per cache key: the first request
  starts the fetch → edit → cache work as a background producer, and any
  concurrent or refreshed request attaches to that same in-flight edit —
  replaying the output streamed so far, then tailing live deltas. Redundant LLM
  calls for the same chapter are eliminated.
- The in-flight edit is decoupled from the request connection, so it now runs to
  completion and caches even if every reader disconnects mid-edit (previously a
  refresh could abort the edit before it was cached). Prefetch shares the same
  single-flight path, closing the prefetch-then-navigate race as well.

## [0.1.0] — 2026-05-29

First release. **stet** is a self-hosted, single-user, mobile-first web app that
turns serialized web fiction into a clean, LLM-edited reading experience with
instant chapter navigation. Point it at a chapter URL and it fetches the page,
extracts the prose and navigation, runs a configurable Claude edit pass, and
renders the result in a distraction-free reader — prefetching the next chapter so
forward navigation is instant.

### Added

**Reading pipeline**
- Fetch → extract → edit → cache → render pipeline with progressive streaming to
  the reader.
- Prefetches exactly one chapter ahead so "next" is usually instant; prefetch
  failures are silent and never block the foreground read.
- Cache hits serve instantly. Switching the editing profile re-edits from cached
  raw text **without re-fetching** the source.

**Fetching**
- HTTP-first fetching that escalates to a headless browser (Playwright/Chromium)
  only for successful pages that are gated or JS-rendered; runs per-site gate
  steps and persists cookies/storage so a cleared gate stays cleared.
- Non-success (non-2xx) responses bail immediately — never escalated to the
  browser and never extracted, edited, or cached (e.g. a transient Cloudflare
  525), surfacing a clear error instead.
- `STET_DISABLE_BROWSER` runs HTTP-only (no Chromium); pages that would need a
  browser show a "needs a browser — open original" notice.

**Extraction**
- Mozilla Readability for chapter body; navigation via `rel`/link-text
  heuristics, on-page chapter indexes, and a chapter-navigation `<select>`
  (e.g. AO3).
- Constrained LLM fallback for navigation that may only *select among real
  on-page links* — it can never invent a URL — with a same-domain plausibility
  guard.
- Title resolution that prefers `og:title` and skips site banners / a11y
  landmark headings.

**Editing**
- Streams a user-supplied Claude edit pass with prompt caching on the system
  prompt; chunks very long chapters at paragraph boundaries and stitches the
  result back together.

**Profiles & site adapters**
- Editing profiles (system prompt + model/params) and optional per-site adapters
  loaded from a watched config folder with hot-reload.

**Library & reader**
- SQLite-backed library of followed serials with resume-where-you-left-off.
- Mobile-first reader: single reading column, dark mode, streaming text,
  prev/next, progress strip, slide-in chapter menu, a settings page (profile
  selector), and hash-based routing so the URL reflects navigation and supports
  back/forward and deep links.
- HTTP/JSON + Server-Sent-Events API.

**Authentication (optional)**
- Optional OpenID Connect access gate (Authorization Code + PKCE) requiring
  membership of a configured group, with a signed-cookie session. Off by default;
  fail-closed (a partial config refuses to boot). No per-user data — just a gate.

**Observability**
- `LOG_LEVEL`-gated structured logs for key operations and OpenTelemetry spans
  (opt-in console exporter via `OTEL_TRACES_EXPORTER=console`).

**Deployment**
- Two container images: a full image with Chromium (Playwright base) and a
  `~5×`-smaller slim image (no browser, `STET_DISABLE_BROWSER=true`).
- A Helm chart (`deploy/helm/stet`): single-replica Deployment, data PVC,
  profiles/adapters from values, Secret (or `existingSecret`), Service, optional
  Ingress, and an unauthenticated `/healthz` probe.
- A GitHub Actions workflow that tests (Node 24) then builds and pushes both
  images to GHCR.

### Tech stack

TypeScript on Node 24, Hono, the Anthropic SDK (streaming + prompt caching),
Playwright (Chromium), Mozilla Readability + jsdom, and SQLite (better-sqlite3).
Roughly 120 tests run with no live network, LLM, or internet-facing browser.

### Non-goals (v1)

No authentication by default, no multi-user/account sync, no EPUB/offline export,
and not a native mobile app (it is a mobile-first web app).

[0.1.0]: https://github.com/dfcowell/stet/releases/tag/v0.1.0
