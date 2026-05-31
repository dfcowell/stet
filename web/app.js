const $ = (id) => document.getElementById(id);
async function apiFetch(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = "/auth/login"; throw new Error("unauthenticated"); }
  return r;
}
const api = {
  profiles: () => apiFetch("/api/profiles").then((r) => r.json()),
  setProfile: (id) => apiFetch("/api/profiles/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }),
  library: () => apiFetch("/api/library").then((r) => r.json()),
  story: (id) => apiFetch(`/api/story/${encodeURIComponent(id)}`).then((r) => r.json()),
  addSerial: (url) => apiFetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.json()),
  progress: (storyId, url) => apiFetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storyId, url }) }),
};

const state = { activeProfile: null, profiles: [], story: null, url: null, meta: null, es: null };

// ----- Routing (hash-based: #/ library, #/settings, #/read?s=storyId&u=chapterUrl) -----

function navigate(hash) {
  if (location.hash === hash) route(); // same route → re-render (e.g. re-open chapter)
  else location.hash = hash;
}

function readHash(url, storyId) {
  const p = new URLSearchParams();
  if (storyId) p.set("s", storyId);
  if (url) p.set("u", url);
  return `#/read?${p.toString()}`;
}

function parseHash() {
  const h = location.hash.replace(/^#/, "");
  const [path, qs] = h.split("?");
  return { path: path || "/", params: new URLSearchParams(qs || "") };
}

async function route() {
  const { path, params } = parseHash();
  if (path === "/settings") return renderSettings();
  if (path === "/read") return renderReader(params.get("u"), params.get("s"));
  return renderLibrary();
}

// ----- Views -----

function showView(which) {
  $("library-view").hidden = which !== "library";
  $("reader-view").hidden = which !== "reader";
  $("settings-view").hidden = which !== "settings";
  $("menu-toggle").hidden = !(which === "reader" && state.story && state.story.chapters.length);
}

function renderLibrary() {
  if (state.es) { state.es.close(); state.es = null; }
  state.story = null;
  showView("library");
  refreshLibrary();
}

function renderSettings() {
  showView("settings");
  if (state.activeProfile) $("profile-select").value = state.activeProfile;
  updateModelLine();
}

async function renderReader(url, storyId) {
  if (storyId) {
    if (!state.story || state.story.id !== storyId) {
      try { state.story = await api.story(storyId); } catch { state.story = null; }
    }
  } else {
    state.story = null;
  }
  const target = url || state.story?.progress.currentChapterUrl || state.story?.chapters[0]?.url;
  if (!target) { renderLibrary(); return; }
  openChapter(target);
}

async function loadProfiles() {
  const { active, profiles } = await api.profiles();
  state.activeProfile = active;
  state.profiles = profiles;
  const sel = $("profile-select");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name; if (p.id === active) o.selected = true;
    sel.appendChild(o);
  }
}

function updateModelLine() {
  const p = state.profiles.find((x) => x.id === state.activeProfile);
  $("profile-model").textContent = p?.model ? `Model: ${p.model}` : "";
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
    li.querySelector(".s-meta").textContent =
      s.chapterCount > 0 ? `${s.sourceDomain} · ${s.chapterCount} chapters` : s.sourceDomain;
    li.addEventListener("click", () => navigate(readHash(null, s.id)));
    list.appendChild(li);
  }
}

function chapterTitleFor(url) {
  return state.story?.chapters.find((c) => c.url === url)?.title ?? "";
}

function buildChapterMenu() {
  const ul = $("chapter-menu-list");
  ul.innerHTML = "";
  if (!state.story) return;
  for (const ch of state.story.chapters) {
    const li = document.createElement("li");
    li.textContent = ch.title || `Chapter ${ch.index + 1}`;
    if (ch.url === state.url) li.classList.add("current");
    li.addEventListener("click", () => { closeMenu(); navigate(readHash(ch.url, state.story?.id)); });
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
  $("serial-title").textContent = state.story?.title || "…";
  const chTitle = chapterTitleFor(url);
  $("chapter-title").textContent = chTitle;
  $("chapter-title").hidden = !chTitle;
  $("chapter-body").textContent = "";
  $("prev-btn").disabled = true; $("next-btn").disabled = true;
  window.scrollTo(0, 0);
  resetNavVisibility();
  setProgressFill();
  buildChapterMenu();

  const qs = new URLSearchParams({ url });
  if (state.activeProfile) qs.set("profileId", state.activeProfile);
  if (state.story?.id) qs.set("storyId", state.story.id);
  const es = new EventSource(`/api/chapter?${qs.toString()}`);
  state.es = es;
  let buffer = "";

  es.addEventListener("meta", (e) => {
    const m = JSON.parse(e.data); state.meta = m;
    // Within a story, the serial title + chapter title come from the chapter
    // list; standalone, the extracted title is the best we have.
    if (!state.story) {
      $("serial-title").textContent = m.title || "Untitled";
      $("chapter-title").hidden = true;
    }
    $("prev-btn").disabled = !m.prevUrl;
    $("next-btn").disabled = !m.nextUrl;
    if (state.story) api.progress(state.story.id, url).catch(() => {});
  });
  es.addEventListener("delta", (e) => {
    buffer += JSON.parse(e.data).text;
    renderBody(buffer);
  });
  es.addEventListener("done", () => {
    es.close(); state.es = null;
    if (state.story?.id) refreshStoryMetadata();
  });
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

async function refreshStoryMetadata() {
  if (!state.story?.id) return;
  let fresh;
  try { fresh = await api.story(state.story.id); } catch { return; }
  if (!fresh || fresh.id !== state.story.id) return;
  state.story = fresh;
  $("serial-title").textContent = state.story.title || "…";
  const ct = chapterTitleFor(state.url);
  $("chapter-title").textContent = ct;
  $("chapter-title").hidden = !ct;
  buildChapterMenu();
  setProgressFill();
  $("menu-toggle").hidden = !(state.story.chapters?.length);
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

// ----- Reader nav auto-hide on scroll -----
// Hide on downward scroll, show on upward scroll. Always show near the top
// and at the bottom of the chapter so the next/prev buttons are reachable
// when the reader finishes a chapter.
const nav = { lastY: 0, ticking: false };
function updateNavVisibility() {
  nav.ticking = false;
  if ($("reader-view").hidden) return;
  const el = $("reader-nav");
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const atBottom = max <= 0 || y >= max - 24;
  const atTop = y < 16;
  const dy = y - nav.lastY;
  if (atBottom || atTop) {
    el.classList.remove("hidden");
  } else if (dy > 6) {
    el.classList.add("hidden");
  } else if (dy < -6) {
    el.classList.remove("hidden");
  }
  nav.lastY = y;
}
function onScroll() {
  if (nav.ticking) return;
  nav.ticking = true;
  requestAnimationFrame(updateNavVisibility);
}
function resetNavVisibility() {
  nav.lastY = window.scrollY;
  $("reader-nav").classList.remove("hidden");
}

function wire() {
  $("home-btn").addEventListener("click", () => navigate("#/"));
  $("settings-btn").addEventListener("click", () => navigate("#/settings"));
  $("menu-toggle").addEventListener("click", openMenu);
  $("menu-close").addEventListener("click", closeMenu);
  $("scrim").addEventListener("click", closeMenu);
  $("prev-btn").addEventListener("click", () => { if (state.meta?.prevUrl) navigate(readHash(state.meta.prevUrl, state.story?.id)); });
  $("next-btn").addEventListener("click", () => { if (state.meta?.nextUrl) navigate(readHash(state.meta.nextUrl, state.story?.id)); });
  $("profile-select").addEventListener("change", async (e) => {
    state.activeProfile = e.target.value;
    await api.setProfile(state.activeProfile).catch(() => {});
    updateModelLine();
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
  window.addEventListener("hashchange", route);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  route();
})();
