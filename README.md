# stet

**stet** is a self-hosted, single-user, mobile-first web app that turns serialized
web fiction into a clean, LLM-edited reading experience with instant chapter
navigation. Give it a chapter URL and it fetches the page, extracts the chapter
body and navigation links, runs a configurable Claude edit pass over the prose,
and renders the result in a distraction-free reader — prefetching the next
chapter as you read so forward navigation is instant.

The name *stet* is the copyediting mark meaning "let it stand."

> Design spec: [`docs/superpowers/specs/2026-05-28-stet-design.md`](docs/superpowers/specs/2026-05-28-stet-design.md).
> Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## How it works

```
URL ─▶ Fetcher ─▶ Extractor ─▶ Editor ─▶ Cache ─▶ Reader
       (HTTP,      (Readability  (Claude    (SQLite)   (SSE stream)
        escalate    body + nav    streaming
        to browser  heuristics +  edit pass,
        for gates)  LLM fallback) chunk/stitch)
```

- **Fetcher** — HTTP-first; escalates to headless Chromium (Playwright) when a page
  is JS-rendered, gated (age/consent wall), or content-thin. Runs per-site gate
  steps and persists cookies so a cleared gate stays cleared.
- **Extractor** — Mozilla Readability for the body; heuristics (`rel=next/prev`,
  link-text, chapter-index detection) for navigation, with a **constrained LLM
  fallback** that may only *select among real on-page links* (it can never invent a
  URL).
- **Editor** — streams a Claude edit pass using your profile's system prompt, with
  prompt caching on the static prompt and paragraph-boundary chunking for very long
  chapters.
- **Cache** — edited chapters keyed by `url + profile + promptHash + model`; also
  stores the raw extraction so switching profiles re-edits **without re-fetching**.
- **Prefetcher** — after a chapter renders, fetch+edit exactly **one** chapter ahead.

## Requirements

- **Node ≥ 22** (developed on 24). `better-sqlite3` compiles a native addon, so a C
  toolchain is needed for `npm install`.
- An **Anthropic API key** for the edit pass.

## Quickstart

```bash
npm install
npx playwright install chromium      # only needed for gated / JS-rendered sites

ANTHROPIC_API_KEY=sk-ant-... npx tsx src/index.ts
# stet listening on http://localhost:8787
```

Open <http://localhost:8787>, paste a chapter (or index) URL into **Add**, and start
reading. Use the profile selector (top-right) to switch edit passes, and the ☰ menu
for the chapter list when a serial provides one.

For live-reload during development: `ANTHROPIC_API_KEY=... npm run dev`.

## Configuration

All config lives in a watched folder (default `./config`) and **hot-reloads** — add
or edit files while the server runs.

### Profiles — `config/profiles/*.md`

Each Markdown file is one editing profile. Optional YAML-ish frontmatter sets the
name and model params; the body is the system prompt. The filename (minus
extension) is the profile id.

```markdown
---
name: Light Copyedit
model: claude-sonnet-4-6
maxTokens: 8192
temperature: 0.4
---
You are a careful copy editor for serialized web fiction. Fix spelling, grammar,
and punctuation; preserve the author's voice, plot, and names; output only the
edited prose.
```

A sample `Light Copyedit` profile ships in `config/profiles/default.md`.

### Site adapters (optional) — `config/adapters/*.json`

Override fetch/extraction behavior for a specific domain. Matched by longest domain
suffix.

```json
{
  "domain": "example-fiction.com",
  "fetchMode": "browser",
  "selectors": { "body": ".chapter-content", "next": "a.next", "prev": "a.prev" },
  "gateSteps": [
    { "action": "click", "selector": "#confirm-18" },
    { "action": "waitForSelector", "selector": ".chapter-content" }
  ]
}
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | Required for the edit pass |
| `PORT` | `8787` | HTTP port |
| `STET_CONFIG_DIR` | `./config` | Profiles + adapters root |
| `STET_DB_PATH` | `./data/stet.sqlite` | SQLite database |
| `STET_STATE_DIR` | `./data/state` | Persisted browser cookies/storage |
| `STET_WEB_DIR` | `./web` | Static frontend directory |
| `LOG_LEVEL` | `info` | Log verbosity: `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `OTEL_TRACES_EXPORTER` | — | Set to `console` to print OpenTelemetry spans to the terminal |

### Logging & tracing

The backend emits readable, leveled logs to stderr for key operations — HTTP
requests, chapter reads (cache hit/miss), fetches (including HTTP status and
whether it escalated to the headless browser), extraction, editing, prefetch,
and serial registration. Set `LOG_LEVEL=debug` to see the full per-operation
trace; `info` (default) shows request lines and milestones.

```bash
LOG_LEVEL=debug ANTHROPIC_API_KEY=sk-ant-... npx tsx src/index.ts
```

Key operations are also instrumented with [OpenTelemetry](https://opentelemetry.io/)
spans (via `@opentelemetry/api`). By default no exporter is registered (spans are
no-ops, so the terminal stays clean). Set `OTEL_TRACES_EXPORTER=console` to print
spans, or register your own SDK/collector to ship them elsewhere.

### Authentication (optional)

stet runs with no auth by default (single-user, self-hosted). To gate access
behind OpenID Connect, set the variables below. If **any** `STET_OIDC_*` variable
is set, **all** required ones must be present or the app refuses to start
(fail-closed). Access then requires an authenticated user who is a member of
`STET_OIDC_GROUP_ID` (read from the ID token's groups claim).

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `STET_OIDC_ISSUER` | yes | — | Issuer / discovery URL |
| `STET_OIDC_CLIENT_ID` | yes | — | OAuth client id |
| `STET_OIDC_CLIENT_SECRET` | yes | — | OAuth client secret |
| `STET_OIDC_GROUP_ID` | yes | — | Required group membership |
| `STET_OIDC_REDIRECT_URI` | yes | — | e.g. `https://host/auth/callback` |
| `STET_SESSION_SECRET` | yes | — | HMAC secret for the session cookie |
| `STET_OIDC_GROUPS_CLAIM` | no | `groups` | ID-token claim holding groups |
| `STET_OIDC_SCOPES` | no | `openid profile email groups` | Requested scopes |
| `STET_SESSION_TTL_HOURS` | no | `168` | Session lifetime |

Register `STET_OIDC_REDIRECT_URI` (the `/auth/callback` URL) with your provider.
Endpoints: `/auth/login`, `/auth/callback`, `/auth/logout`.

## HTTP API

| Method & path | Description |
|---------------|-------------|
| `GET /api/chapter?url=<enc>&profileId=<opt>` | **SSE** stream of `meta` / `delta` / `done` / `error` events for the edited chapter |
| `GET /api/profiles` | `{ active, profiles: [{ id, name }] }` |
| `POST /api/profiles/active` `{ id }` | Switch the active profile |
| `GET /api/library` | List followed serials |
| `GET /api/story/:id` | Full story (chapters + progress) |
| `POST /api/library` `{ url }` | Add a serial (walks prev/next or an index page) |
| `POST /api/progress` `{ storyId, url }` | Record reading progress |

The chapter endpoint fire-and-forget prefetches the next chapter after `done`.

## Scripts

| Script | Action |
|--------|--------|
| `npm run dev` | Run with live reload (`tsx watch`) |
| `npm run build` | Type-check + emit JS to `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Watch-mode tests |

## Testing

Tests use **no live network, no real LLM, and no internet-facing browser**: the
extractor/editor run against a `FakeLlmClient`, the fetcher and pipeline run against
a local fixture HTTP server, and the Playwright gate test drives a local fixture
page. Run `npm test` (currently 77 tests).

## Status & limitations

- Single-user, self-hosted; no auth, no multi-device sync, no EPUB export (v1
  non-goals).
- Actual editing requires a valid `ANTHROPIC_API_KEY`; without one the app still
  boots and serves the library/UI, but chapter reads surface an error.
- Token thresholds for chunking and per-site index-walking strategies are tuned
  conservatively and may need per-site adapters for unusual layouts.
