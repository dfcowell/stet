# Opportunistic Serial Metadata Refresh

## Problem

Serial-level metadata (title, chapter list, index URL) is captured exactly
once, at `registerSerial` time, and never updated. Two failure modes follow:

1. **Bad first fetch poisons the row.** `registerSerial` does not check
   `fr.status`, so a Cloudflare / 5xx error page yields a junk title and an
   empty chapter list that persist forever.
2. **Late-discovered metadata is wasted.** Per-chapter fetches in the pipeline
   already extract chapter-nav `<select>` lists (`chapterLinks`) and could
   extract a serial title, but the pipeline discards everything except the
   chapter-shaped fields. Stories that fail at register-time never recover even
   when the user successfully reads a chapter.

## Approach

On every chapter read, capture *all* the serial-level metadata the page
exposes and merge it into the stored story row using simple, monotone rules.
The first successful chapter read is enough to repair a story whose
registration captured nothing useful, so no separate "refresh" action,
manual button, or registration-time error handling is needed.

## Changes

### Adapter conceptual model

The current adapter `selectors` map covers chapter-level content (`body`,
`next`, `prev`, `index`). Extend it with serial-level overrides — same
contract as the existing selectors:

```ts
selectors?: {
  body?: string;
  next?: string;
  prev?: string;
  index?: string;
  serialTitle?: string;   // NEW
  chapterTitle?: string;  // NEW
  chapterList?: string;   // NEW — container whose <a> descendants are chapters
};
```

Adapter selectors always win over heuristics. Adapter JSON files in
`config/adapters/` pick up the new fields automatically — no schema change.

### Extractor

Add `serialTitle: string | null` to `ExtractedChapter`. Resolution order
(first non-empty wins):

1. `adapter.selectors.serialTitle` → element's text
2. `<meta property="og:novel:novel_name">` (light-novel sites)
3. `<meta property="article:series">` / `<meta property="book:series">`
4. Breadcrumb penultimate item (when a `[aria-label*=breadcrumb i]` or
   `nav.breadcrumb` exists)
5. `<title>` split on ` - `, ` | `, ` :: `, ` — `, ` – ` — pick the longest
   part that is neither chapter-numeric (e.g. matches `^(Chapter|Part|Ep\.?|Ch\.?)\s*\d`)
   nor equal to the chapter title
6. `<meta property="og:site_name">` — last resort; for single-serial-per-site
   sources (most fanfic forums) this is the serial. Skip if equal to hostname
   root.

Result is `null` when nothing produces a non-trivial string.

Extend `adapter.selectors.chapterTitle`: when set, the chapter title is the
element's text instead of the existing `og:title` / content-heading
heuristic.

Extend `adapter.selectors.chapterList`: when set, `chapterLinks` is collected
from `<a>` descendants of the element (overrides both `detectChapterIndex`
and `chaptersFromSelect`).

### RawChapter

Add two profile-independent fields:

```ts
interface RawChapter {
  // ... existing fields
  chapterLinks: ChapterLink[];   // currently dropped; persist now
  serialTitle: string | null;    // new
}
```

Persist via a new migration that adds `chapter_links_json` and `serial_title`
columns to `raw_chapter`. `chapterLinks` defaults to `[]` for legacy rows;
`serialTitle` defaults to `NULL`.

### LibraryStore

Add `mergeStoryMetadata(stored, fresh) → Story`:

| Field      | Rule                                                        |
|------------|-------------------------------------------------------------|
| `chapters` | `fresh.length > stored.length` → fresh; otherwise stored    |
| `indexUrl` | `stored ?? fresh`                                           |
| `title`    | `isNonTrivial(fresh) ? fresh : stored`                      |

`isNonTrivial(title)`: non-empty after trim, not equal to `sourceDomain`,
not chapter-numeric. The "latest non-trivial wins" rule for title means
stable extractors produce stable titles; if an adapter is misconfigured and
extraction flickers, that's a bug in the adapter rather than something the
merge should mask.

No new store method needed — caller composes `mergeStoryMetadata` with
`library.upsertStory`.

### Pipeline

`loadRaw` populates the new `RawChapter` fields from the extraction. No
behavioural change to streaming or caching.

### Server

`GET /api/chapter` accepts an optional `storyId` query param. After the SSE
stream terminates and `storyId` is present:

1. `library.getStory(storyId)` — bail if missing
2. `cache.getRawByUrl(url)` — always populated by this point (loadRaw writes
   before edit starts)
3. Build a `fresh` snapshot: `{ title: raw.serialTitle, indexUrl: raw.indexUrl, chapters: raw.chapterLinks }`
4. `library.upsertStory(mergeStoryMetadata(stored, fresh))`

The merge runs synchronously after the stream ends; the request stays open
just long enough for the merge to commit (sub-millisecond on SQLite).

### Web

- `app.js` passes `storyId` as a query param when opening a chapter inside a
  story (already known: `state.story?.id`).
- After the `meta` event arrives, refresh `state.story = await api.story(storyId)`
  and rebuild the chapter menu / progress fill. This makes the new chapter
  list visible without a page reload.

## Out of scope

- Title-rename UI (still no manual override; not needed for the failure mode
  this spec addresses).
- Repair of `registerSerial`'s non-2xx handling. The user's call: the first
  successful read fixes it.
- Per-story "refresh metadata" button — opportunistic refresh subsumes it.

## Edge cases

- **Adapter present but selectors don't match the page**: fall through to
  heuristics, same as existing `body` / `next` / `prev` behaviour.
- **`fresh.chapters` strictly longer but contains spurious links**: the
  monotone rule prefers it. Mitigation: adapter `chapterList` selector for
  noisy sites. If this turns out to bite real serials we can add a stability
  check (only replace if the prefix matches), but YAGNI for now.
- **`title` flickers across chapters on a poorly-configured site**: latest
  non-trivial wins. Visible as the story title changing in the library list
  after each read; the fix is the `serialTitle` adapter selector.
- **`storyId` not passed (standalone chapter read)**: merge is skipped;
  current behaviour preserved.
