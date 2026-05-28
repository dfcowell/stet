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
