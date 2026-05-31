import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChapterCache, ProfileStore, LibraryStore, Story } from "../types.js";
import type { Pipeline } from "../pipeline/index.js";
import type { Auth } from "../auth/index.js";
import { mergeStoryMetadata } from "../library/mergeMetadata.js";
import { log } from "../obs/index.js";

export interface AppDeps {
  pipeline: Pipeline;
  profiles: ProfileStore;
  library: LibraryStore;
  cache: ChapterCache;
  addSerial: (url: string) => Promise<Story>;
  webDir: string;
  auth?: Auth;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    log.info("http", { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start });
  });

  // Unauthenticated health check — registered before the gate so probes pass
  // even when the OIDC gate is enabled.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  if (deps.auth) {
    app.use("*", deps.auth.middleware);
    deps.auth.registerRoutes(app);
  }

  app.get("/api/chapter", (c) => {
    const url = c.req.query("url");
    const profileId = c.req.query("profileId");
    const storyId = c.req.query("storyId");
    if (!url) return c.json({ error: "url required" }, 400);
    return streamSSE(c, async (stream) => {
      let nextUrl: string | null = null;
      for await (const ev of deps.pipeline.readChapter(url, profileId ? { profileId } : undefined)) {
        if (ev.type === "meta") nextUrl = ev.nextUrl;
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
      if (storyId) {
        const stored = deps.library.getStory(storyId);
        const raw = deps.cache.getRawByUrl(url);
        if (stored && raw) {
          const merged = mergeStoryMetadata(stored, {
            title: raw.serialTitle,
            indexUrl: raw.indexUrl,
            chapters: raw.chapterLinks,
          });
          if (merged !== stored) {
            deps.library.upsertStory(merged);
            log.debug("story metadata refreshed", { storyId, title: merged.title, chapters: merged.chapters.length });
          }
        }
      }
      if (nextUrl) {
        log.debug("prefetch next", { nextUrl });
        void deps.pipeline.prefetch(nextUrl, profileId ? { profileId } : undefined);
      }
    });
  });

  app.get("/api/profiles", (c) =>
    c.json({ active: deps.profiles.getActive().id, profiles: deps.profiles.list().map((p) => ({ id: p.id, name: p.name, model: p.model })) }));

  app.post("/api/profiles/active", async (c) => {
    const { id } = await c.req.json<{ id: string }>();
    try { deps.profiles.setActive(id); } catch { return c.json({ error: "unknown profile" }, 404); }
    return c.json({ active: deps.profiles.getActive().id });
  });

  app.get("/api/library", (c) =>
    c.json({ stories: deps.library.listStories().map((s) => ({
      id: s.id, title: s.title, sourceDomain: s.sourceDomain,
      currentChapterUrl: s.progress.currentChapterUrl, chapterCount: s.chapters.length,
    })) }));

  app.get("/api/story/:id", (c) => {
    const s = deps.library.getStory(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/library", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    if (!url) return c.json({ error: "url required" }, 400);
    const story = await deps.addSerial(url);
    deps.library.upsertStory(story);
    return c.json({ id: story.id, title: story.title, chapters: story.chapters });
  });

  app.post("/api/progress", async (c) => {
    const { storyId, url } = await c.req.json<{ storyId: string; url: string }>();
    deps.library.setProgress(storyId, url, Date.now());
    return c.json({ ok: true });
  });

  return app;
}
