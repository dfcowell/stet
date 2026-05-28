import { describe, it, expect } from "vitest";
import { createApp, type AppDeps } from "./app.js";
import type { ProfileStore, LibraryStore, Story } from "../types.js";
import type { Pipeline, ReadEvent } from "../pipeline/index.js";
import type { Auth } from "../auth/index.js";

const profile = { id: "p", name: "Light", systemPrompt: "s", model: "m", maxTokens: 10, temperature: 1, promptHash: "h" };
function fakeProfiles(): ProfileStore {
  let active = "p";
  return {
    list: () => [profile], get: (id) => (id === "p" ? profile : undefined),
    getActive: () => profile, setActive: (id) => { if (id !== "p") throw new Error("nope"); active = id; },
    onChange: () => () => {}, close: () => {},
  };
}
function fakeLibrary(stories: Story[] = []): LibraryStore {
  const map = new Map(stories.map((s) => [s.id, s]));
  return {
    listStories: () => [...map.values()], getStory: (id) => map.get(id),
    upsertStory: (s) => { map.set(s.id, s); }, setProgress: (id, url, at) => { const s = map.get(id); if (s) s.progress = { currentChapterUrl: url, lastReadAt: at }; },
  };
}
const events: ReadEvent[] = [
  { type: "meta", title: "Chapter 1", nextUrl: "https://s/2", prevUrl: null, cached: false },
  { type: "delta", text: "Hello " }, { type: "delta", text: "world" }, { type: "done", full: "Hello world" },
];
const fakePipeline: Pipeline = {
  async *readChapter() { for (const e of events) yield e; },
  async prefetch() {},
};

function app(over: Partial<AppDeps> = {}) {
  return createApp({
    pipeline: fakePipeline, profiles: fakeProfiles(), library: fakeLibrary(),
    addSerial: async (url) => ({ id: "st1", title: "Built", sourceDomain: "s", indexUrl: null, chapters: [{ title: "c1", url, index: 0 }], progress: { currentChapterUrl: url, lastReadAt: null } }),
    webDir: "web", ...over,
  });
}

describe("GET /api/chapter (SSE)", () => {
  it("streams meta, deltas, and done as SSE events", async () => {
    const res = await app().request("/api/chapter?url=" + encodeURIComponent("https://s/1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: meta");
    expect(text).toContain('"title":"Chapter 1"');
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
    expect(text).toContain('"full":"Hello world"');
  });

  it("400s without a url", async () => {
    const res = await app().request("/api/chapter");
    expect(res.status).toBe(400);
  });
});

describe("profiles + library + progress", () => {
  it("lists profiles with the active id", async () => {
    const res = await app().request("/api/profiles");
    expect(await res.json()).toEqual({ active: "p", profiles: [{ id: "p", name: "Light", model: "m" }] });
  });
  it("sets the active profile and 404s unknown", async () => {
    const ok = await app().request("/api/profiles/active", { method: "POST", body: JSON.stringify({ id: "p" }), headers: { "content-type": "application/json" } });
    expect(await ok.json()).toEqual({ active: "p" });
    const bad = await app().request("/api/profiles/active", { method: "POST", body: JSON.stringify({ id: "zzz" }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(404);
  });
  it("adds a serial and lists it", async () => {
    const a = app();
    const add = await a.request("/api/library", { method: "POST", body: JSON.stringify({ url: "https://s/1" }), headers: { "content-type": "application/json" } });
    const built = await add.json();
    expect(built.id).toBe("st1");
    const list = await a.request("/api/library");
    const { stories } = await list.json();
    expect(stories).toEqual([{ id: "st1", title: "Built", sourceDomain: "s", currentChapterUrl: "https://s/1", chapterCount: 1 }]);
  });
  it("records progress", async () => {
    const lib = fakeLibrary([{ id: "st1", title: "T", sourceDomain: "s", indexUrl: null, chapters: [], progress: { currentChapterUrl: null, lastReadAt: null } }]);
    const a = app({ library: lib });
    const res = await a.request("/api/progress", { method: "POST", body: JSON.stringify({ storyId: "st1", url: "https://s/2" }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.getStory("st1")!.progress.currentChapterUrl).toBe("https://s/2");
  });
});

describe("auth wiring", () => {
  const fakeAuth: Auth = {
    middleware: async (c, next) => {
      if (c.req.path.startsWith("/auth/")) return next();
      return c.json({ error: "unauthenticated" }, 401);
    },
    registerRoutes: (a) => { a.get("/auth/ping", (c) => c.text("pong")); },
  };

  it("gates API routes and serves /auth/* when auth is provided", async () => {
    const a = app({ auth: fakeAuth });
    expect((await a.request("/api/profiles")).status).toBe(401);
    const ping = await a.request("/auth/ping");
    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("pong");
  });

  it("does not gate anything when auth is absent", async () => {
    expect((await app().request("/api/profiles")).status).toBe(200);
  });

  it("serves /healthz unauthenticated even when the gate is enabled", async () => {
    const res = await app({ auth: fakeAuth }).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
