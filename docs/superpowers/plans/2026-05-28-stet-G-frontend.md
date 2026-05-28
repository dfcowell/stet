# stet Frontend Reader Implementation Plan (Wave 2 — G)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem owns the `web/` directory ONLY. It is a buildless, dependency-free static frontend (plain HTML/CSS/ES-module JS) served by the server. Do NOT edit `package.json`, `vitest.config.ts`, any `src/` file, or add npm dependencies. There is no bundler and no vitest test for this subsystem (vitest only collects `src/**` and `test/**`); verification is `node --check` on the JS plus the orchestrator's runtime smoke test.

**Goal:** Build the mobile-first immersive reader UI: a centered reading column with comfortable typography, a thin top bar (chapter-menu toggle + active-profile selector), a progress strip, prev/next controls, a slide-in chapter menu, and a library/add-serial view. It consumes the server's JSON + SSE API.

**Architecture:** Three files — `web/index.html` (structure), `web/styles.css` (mobile-first styling), `web/app.js` (an ES module: API client + `EventSource` SSE reader + view state). Chapter text streams in progressively via SSE; the `EventSource` is closed on `done`/`error` to prevent auto-reconnect re-triggering the read.

**Tech Stack:** Vanilla HTML/CSS/JS. Native `fetch` + `EventSource`. No build step.

## API CONTRACT (shared verbatim with the Server plan — consume exactly this)

- `GET /api/chapter?url=<enc>&profileId=<opt>` → SSE; events `meta`/`delta`/`done`/`error`, each `data:` a JSON object (`meta`: `{title,nextUrl,prevUrl,cached}`; `delta`: `{text}`; `done`: `{full}`; `error`: `{message}`).
- `GET /api/profiles` → `{active, profiles:[{id,name}]}`
- `POST /api/profiles/active` `{id}` → `{active}`
- `GET /api/library` → `{stories:[{id,title,sourceDomain,currentChapterUrl,chapterCount}]}`
- `GET /api/story/:id` → full `Story` (`{id,title,sourceDomain,indexUrl,chapters:[{title,url,index}],progress:{currentChapterUrl,lastReadAt}}`)
- `POST /api/library` `{url}` → `{id,title,chapters}`
- `POST /api/progress` `{storyId,url}` → `{ok:true}`

---

### Task 1: HTML structure

**Files:**
- Create: `web/index.html`

- [ ] **Step 1: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>stet</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <button id="menu-toggle" class="icon-btn" aria-label="Chapters" hidden>☰</button>
    <button id="home-btn" class="icon-btn" aria-label="Library">stet</button>
    <select id="profile-select" class="profile-select" aria-label="Edit profile"></select>
  </header>

  <div id="progress-strip" class="progress-strip"><div id="progress-fill"></div></div>

  <!-- Library view -->
  <main id="library-view" class="view">
    <h1 class="lib-title">Library</h1>
    <form id="add-form" class="add-form">
      <input id="add-url" type="url" placeholder="Paste a chapter or index URL…" required>
      <button type="submit">Add</button>
    </form>
    <ul id="story-list" class="story-list"></ul>
    <p id="lib-empty" class="muted">No serials yet — paste a URL above to begin.</p>
  </main>

  <!-- Reader view -->
  <main id="reader-view" class="view" hidden>
    <article id="chapter" class="chapter">
      <h2 id="chapter-title" class="chapter-title"></h2>
      <div id="chapter-body" class="chapter-body"></div>
    </article>
    <div id="reader-error" class="reader-error" hidden></div>
    <nav class="reader-nav">
      <button id="prev-btn" disabled>‹ Prev</button>
      <button id="next-btn" disabled>Next ›</button>
    </nav>
  </main>

  <!-- Slide-in chapter menu -->
  <aside id="chapter-menu" class="chapter-menu" hidden>
    <div class="chapter-menu-head"><span>Chapters</span><button id="menu-close" class="icon-btn">✕</button></div>
    <ul id="chapter-menu-list"></ul>
  </aside>
  <div id="scrim" class="scrim" hidden></div>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2:** Run `xmllint --noout web/index.html 2>/dev/null || echo "xmllint absent — skip"` (optional). Commit.

```bash
git add web/index.html
git commit -m "feat(web): add reader/library HTML structure"
```

---

### Task 2: Mobile-first styles

**Files:**
- Create: `web/styles.css`

- [ ] **Step 1: Write `web/styles.css`**

```css
:root {
  --bg: #faf8f4; --fg: #1f1b16; --muted: #8a8276; --accent: #8a5a2b;
  --col: 38rem; --bar: 3rem;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #16140f; --fg: #ece6da; --muted: #9a9080; --accent: #d8a35e; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: 1.125rem/1.7 Georgia, "Iowan Old Style", "Times New Roman", serif;
  -webkit-text-size-adjust: 100%;
}
.topbar {
  position: sticky; top: 0; height: var(--bar); display: flex; align-items: center; gap: .5rem;
  padding: 0 .75rem; background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
  padding-top: env(safe-area-inset-top);
}
.icon-btn { background: none; border: 0; color: var(--fg); font: inherit; font-size: 1rem; cursor: pointer; padding: .4rem .6rem; }
#home-btn { font-weight: 700; letter-spacing: .02em; }
.profile-select { margin-left: auto; background: transparent; color: var(--fg); border: 1px solid color-mix(in srgb, var(--fg) 20%, transparent); border-radius: .4rem; padding: .25rem .5rem; font-size: .85rem; }
.progress-strip { height: 3px; background: transparent; }
#progress-fill { height: 100%; width: 0; background: var(--accent); transition: width .2s ease; }
.view { max-width: var(--col); margin: 0 auto; padding: 1.25rem 1.25rem 5rem; }
.chapter-title { font-size: 1.5rem; line-height: 1.25; margin: .5rem 0 1.25rem; }
.chapter-body p { margin: 0 0 1.1rem; }
.muted { color: var(--muted); }
.add-form { display: flex; gap: .5rem; margin: 1rem 0 1.5rem; }
.add-form input { flex: 1; padding: .6rem .7rem; font-size: 1rem; border: 1px solid color-mix(in srgb, var(--fg) 20%, transparent); border-radius: .5rem; background: var(--bg); color: var(--fg); }
.add-form button, .reader-nav button { padding: .6rem 1rem; font: inherit; font-size: .95rem; border: 1px solid var(--accent); color: var(--accent); background: transparent; border-radius: .5rem; cursor: pointer; }
.story-list { list-style: none; padding: 0; margin: 0; }
.story-list li { padding: .9rem 0; border-bottom: 1px solid color-mix(in srgb, var(--fg) 10%, transparent); cursor: pointer; }
.story-list .s-title { font-weight: 600; }
.story-list .s-meta { font-size: .85rem; color: var(--muted); }
.reader-nav { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: .5rem; max-width: var(--col); margin: 0 auto; padding: .6rem 1.25rem calc(.6rem + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(8px); }
.reader-nav button[disabled] { opacity: .35; cursor: default; }
.reader-error { margin: 1rem 0; padding: .8rem 1rem; border-radius: .5rem; border: 1px solid var(--accent); color: var(--accent); }
.reader-error a { color: var(--accent); }
.chapter-menu { position: fixed; top: 0; bottom: 0; left: 0; width: min(80vw, 20rem); background: var(--bg); border-right: 1px solid color-mix(in srgb, var(--fg) 14%, transparent); transform: translateX(-100%); transition: transform .25s ease; z-index: 20; overflow-y: auto; padding-top: env(safe-area-inset-top); }
.chapter-menu.open { transform: translateX(0); }
.chapter-menu-head { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-bottom: 1px solid color-mix(in srgb, var(--fg) 12%, transparent); font-weight: 600; }
.chapter-menu ul { list-style: none; margin: 0; padding: 0; }
.chapter-menu li { padding: .7rem 1rem; border-bottom: 1px solid color-mix(in srgb, var(--fg) 8%, transparent); cursor: pointer; font-size: .95rem; }
.chapter-menu li.current { color: var(--accent); font-weight: 600; }
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 10; }
```

- [ ] **Step 2: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add mobile-first reader styles with dark mode"
```

---

### Task 3: App logic (API client + SSE reader + views)

**Files:**
- Create: `web/app.js`

- [ ] **Step 1: Write `web/app.js`**

```javascript
const $ = (id) => document.getElementById(id);
const api = {
  profiles: () => fetch("/api/profiles").then((r) => r.json()),
  setProfile: (id) => fetch("/api/profiles/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }),
  library: () => fetch("/api/library").then((r) => r.json()),
  story: (id) => fetch(`/api/story/${encodeURIComponent(id)}`).then((r) => r.json()),
  addSerial: (url) => fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.json()),
  progress: (storyId, url) => fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storyId, url }) }),
};

const state = { activeProfile: null, story: null, url: null, meta: null, es: null };

function showView(which) {
  $("library-view").hidden = which !== "library";
  $("reader-view").hidden = which !== "reader";
  $("menu-toggle").hidden = !(which === "reader" && state.story && state.story.chapters.length);
  if (which === "library") refreshLibrary();
}

async function loadProfiles() {
  const { active, profiles } = await api.profiles();
  state.activeProfile = active;
  const sel = $("profile-select");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name; if (p.id === active) o.selected = true;
    sel.appendChild(o);
  }
}

async function refreshLibrary() {
  const { stories } = await api.library();
  const list = $("story-list");
  list.innerHTML = "";
  $("lib-empty").hidden = stories.length > 0;
  for (const s of stories) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="s-title"></div><div class="s-meta"></div>`;
    li.querySelector(".s-title").textContent = s.title;
    li.querySelector(".s-meta").textContent = `${s.sourceDomain} · ${s.chapterCount} chapters`;
    li.addEventListener("click", () => openStory(s.id));
    list.appendChild(li);
  }
}

async function openStory(id) {
  const story = await api.story(id);
  state.story = story;
  const startUrl = story.progress.currentChapterUrl || (story.chapters[0] && story.chapters[0].url);
  buildChapterMenu();
  if (startUrl) openChapter(startUrl);
}

function buildChapterMenu() {
  const ul = $("chapter-menu-list");
  ul.innerHTML = "";
  if (!state.story) return;
  for (const ch of state.story.chapters) {
    const li = document.createElement("li");
    li.textContent = ch.title || `Chapter ${ch.index + 1}`;
    if (ch.url === state.url) li.classList.add("current");
    li.addEventListener("click", () => { closeMenu(); openChapter(ch.url); });
    ul.appendChild(li);
  }
}

function setProgressFill() {
  if (!state.story || !state.url) { $("progress-fill").style.width = "0"; return; }
  const idx = state.story.chapters.findIndex((c) => c.url === state.url);
  const total = state.story.chapters.length || 1;
  $("progress-fill").style.width = `${Math.max(0, ((idx + 1) / total) * 100)}%`;
}

function openChapter(url) {
  if (state.es) { state.es.close(); state.es = null; }
  state.url = url;
  showView("reader");
  $("reader-error").hidden = true;
  $("chapter-title").textContent = "…";
  $("chapter-body").textContent = "";
  $("prev-btn").disabled = true; $("next-btn").disabled = true;
  window.scrollTo(0, 0);
  setProgressFill();
  buildChapterMenu();

  const qs = new URLSearchParams({ url });
  if (state.activeProfile) qs.set("profileId", state.activeProfile);
  const es = new EventSource(`/api/chapter?${qs.toString()}`);
  state.es = es;
  let buffer = "";

  es.addEventListener("meta", (e) => {
    const m = JSON.parse(e.data); state.meta = m;
    $("chapter-title").textContent = m.title || "Untitled";
    $("prev-btn").disabled = !m.prevUrl;
    $("next-btn").disabled = !m.nextUrl;
    if (state.story) api.progress(state.story.id, url).catch(() => {});
  });
  es.addEventListener("delta", (e) => {
    buffer += JSON.parse(e.data).text;
    renderBody(buffer);
  });
  es.addEventListener("done", () => { es.close(); state.es = null; });
  es.addEventListener("error", (e) => {
    es.close(); state.es = null;
    let msg = "Couldn't load this chapter.";
    try { if (e.data) msg = JSON.parse(e.data).message; } catch {}
    const box = $("reader-error");
    box.hidden = false;
    box.innerHTML = "";
    box.append(`${msg} `);
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.textContent = "Open original";
    box.append(a);
  });
}

function renderBody(text) {
  const body = $("chapter-body");
  body.innerHTML = "";
  for (const para of text.split(/\n{2,}/)) {
    if (!para.trim()) continue;
    const p = document.createElement("p");
    p.textContent = para;
    body.appendChild(p);
  }
}

function openMenu() { $("chapter-menu").hidden = false; requestAnimationFrame(() => $("chapter-menu").classList.add("open")); $("scrim").hidden = false; }
function closeMenu() { $("chapter-menu").classList.remove("open"); $("scrim").hidden = true; setTimeout(() => { $("chapter-menu").hidden = true; }, 250); }

function wire() {
  $("home-btn").addEventListener("click", () => { state.story = null; showView("library"); });
  $("menu-toggle").addEventListener("click", openMenu);
  $("menu-close").addEventListener("click", closeMenu);
  $("scrim").addEventListener("click", closeMenu);
  $("prev-btn").addEventListener("click", () => { if (state.meta && state.meta.prevUrl) openChapter(state.meta.prevUrl); });
  $("next-btn").addEventListener("click", () => { if (state.meta && state.meta.nextUrl) openChapter(state.meta.nextUrl); });
  $("profile-select").addEventListener("change", async (e) => {
    state.activeProfile = e.target.value;
    await api.setProfile(state.activeProfile).catch(() => {});
    if (!$("reader-view").hidden && state.url) openChapter(state.url); // re-edit current
  });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("add-url").value.trim();
    if (!url) return;
    $("add-url").value = "";
    try { await api.addSerial(url); await refreshLibrary(); } catch {}
  });
}

(async function init() {
  wire();
  try { await loadProfiles(); } catch {}
  showView("library");
})();
```

- [ ] **Step 2: Syntax-check the JS**

Run: `node --check web/app.js`
Expected: no output (valid). (ES-module top-level `await`/DOM refs are not executed by `--check`, so this only validates syntax.)

- [ ] **Step 3: Commit**

```bash
git add web/app.js
git commit -m "feat(web): add reader app — SSE streaming, library, profiles, chapter menu"
```

---

## Self-Review
1. **Spec coverage:** mobile-first centered reading column + serif typography ✔; thin top bar with chapter-menu toggle + profile selector ✔; progress strip ✔; prev/next ✔; slide-in chapter menu (shown when a story has chapters) ✔; library/add-serial + resume (uses `progress.currentChapterUrl`) ✔; streaming via SSE ✔; error → banner + "open original" link ✔; profile switch re-reads current chapter ✔.
2. **Placeholder scan:** none.
3. **Contract consistency:** every endpoint/field matches the API contract above; `EventSource` closed on `done`/`error` to avoid reconnect re-triggering the edit.
4. **No edits outside `web/`**; no dependencies; no build step.

> Verification is `node --check web/app.js` plus the orchestrator's runtime smoke test (load the app, open a chapter, watch it stream). No vitest test (vitest collects only `src/**`/`test/**`).
