import type {
  Fetcher, Extractor, Editor, ChapterCache, ProfileStore, AdapterStore,
  Profile, RawChapter,
} from "../types.js";
import { computeCacheKey } from "../util/cacheKey.js";
import { createInflightRegistry } from "./inflight.js";
import { log, withSpan } from "../obs/index.js";

export type ReadEvent =
  | { type: "meta"; title: string; nextUrl: string | null; prevUrl: string | null; cached: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; full: string }
  | { type: "error"; message: string };

export interface Pipeline {
  readChapter(url: string, opts?: { profileId?: string }): AsyncIterable<ReadEvent>;
  prefetch(url: string, opts?: { profileId?: string }): Promise<void>;
}

export interface PipelineDeps {
  fetcher: Fetcher;
  extractor: Extractor;
  editor: Editor;
  cache: ChapterCache;
  profiles: ProfileStore;
  adapters: AdapterStore;
}

class FetchError extends Error {
  constructor(public readonly status: number) {
    super(`source responded with HTTP ${status}`);
    this.name = "FetchError";
  }
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const registry = createInflightRegistry();

  function resolveProfile(profileId?: string): Profile {
    if (profileId) {
      const p = deps.profiles.get(profileId);
      if (p) return p;
    }
    return deps.profiles.getActive();
  }

  async function loadRaw(url: string): Promise<RawChapter> {
    const cached = deps.cache.getRawByUrl(url);
    if (cached) {
      log.debug("raw cache hit", { url });
      return cached;
    }
    return withSpan(
      "load_raw",
      async () => {
        const adapter = deps.adapters.forDomain(new URL(url).hostname);
        const fr = await deps.fetcher.fetch(url, adapter);
        // Bail on any non-2xx response: never extract, edit, or cache an error
        // page (e.g. a Cloudflare 525).
        if (fr.status < 200 || fr.status >= 300) {
          log.warn("fetch returned non-2xx", { url, status: fr.status });
          throw new FetchError(fr.status);
        }
        const extracted = await deps.extractor.extract({ html: fr.html, sourceUrl: fr.finalUrl, adapter });
        log.debug("extracted", {
          url, title: extracted.title, navConfidence: extracted.navConfidence,
          nextUrl: extracted.nextUrl, chars: extracted.rawText.length,
        });
        const raw: RawChapter = {
          url,
          extractedTitle: extracted.title,
          serialTitle: extracted.serialTitle,
          rawExtractedText: extracted.rawText,
          nextUrl: extracted.nextUrl,
          prevUrl: extracted.prevUrl,
          indexUrl: extracted.indexUrl,
          chapterLinks: extracted.chapterLinks,
          fetchedAt: Date.now(),
        };
        deps.cache.putRaw(raw);
        return raw;
      },
      { url },
    );
  }

  // The single in-flight producer for a cache miss: fetch -> meta -> edit ->
  // cache -> done. Always ends with a terminal `done` or `error` event, and
  // writes the cache *before* emitting `done` so post-completion reads hit it.
  async function* produceReadEvents(
    url: string,
    profile: Profile,
    key: string,
  ): AsyncIterable<ReadEvent> {
    let raw: RawChapter;
    try {
      raw = await loadRaw(url);
    } catch (err) {
      let message: string;
      if (err instanceof FetchError) {
        message = `The source returned an error (HTTP ${err.status}). The chapter was not loaded.`;
      } else if (err instanceof Error && err.name === "BrowserUnavailableError") {
        message = 'This chapter needs a full browser to load, which is disabled in this deployment. Use "Open original" to read it.';
      } else {
        message = "Couldn't fetch this chapter.";
      }
      log.warn("read chapter failed", { url, error: err instanceof Error ? err.message : String(err) });
      yield { type: "error", message };
      return;
    }
    yield { type: "meta", title: raw.extractedTitle, nextUrl: raw.nextUrl, prevUrl: raw.prevUrl, cached: false };

    log.debug("editing", { url, profile: profile.id, chars: raw.rawExtractedText.length });
    let full = "";
    for await (const ev of deps.editor.edit(raw.rawExtractedText, profile)) {
      if (ev.type === "delta") {
        full += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "done") {
        full = ev.full;
      } else {
        log.warn("edit failed", { url, error: ev.message });
        yield { type: "error", message: ev.message };
        return; // failed edit is never cached as success
      }
    }

    deps.cache.put({
      key, url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
      editedContent: full, extractedTitle: raw.extractedTitle,
      nextUrl: raw.nextUrl, prevUrl: raw.prevUrl, rawExtractedText: raw.rawExtractedText,
      fetchedAt: Date.now(),
    });
    log.info("chapter ready", { url, editedChars: full.length });
    yield { type: "done", full };
  }

  async function* readChapter(url: string, opts?: { profileId?: string }): AsyncIterable<ReadEvent> {
    const profile = resolveProfile(opts?.profileId);
    const key = computeCacheKey({
      url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
    });

    const hit = deps.cache.get(key);
    if (hit) {
      log.info("read chapter", { url, profile: profile.id, cached: true });
      yield { type: "meta", title: hit.extractedTitle, nextUrl: hit.nextUrl, prevUrl: hit.prevUrl, cached: true };
      yield { type: "delta", text: hit.editedContent };
      yield { type: "done", full: hit.editedContent };
      return;
    }

    log.info("read chapter", { url, profile: profile.id, cached: false });
    // Single-flight: start the edit if none is running for this key, otherwise
    // attach to the in-flight one (the refresh / concurrent-read case).
    const handle = registry.getOrStart(key, () => produceReadEvents(url, profile, key));
    yield* handle.subscribe();
  }

  async function prefetch(url: string, opts?: { profileId?: string }): Promise<void> {
    try {
      const profile = resolveProfile(opts?.profileId);
      const key = computeCacheKey({
        url, profileId: profile.id, promptHash: profile.promptHash, model: profile.model,
      });
      if (deps.cache.get(key)) return; // already warm
      log.debug("prefetch start", { url });
      // Start (or attach to) the single in-flight edit and drain it so this
      // promise resolves once the chapter is warmed. The producer is detached,
      // so the edit completes and caches even if no one stays subscribed.
      const handle = registry.getOrStart(key, () => produceReadEvents(url, profile, key));
      for await (const ev of handle.subscribe()) {
        if (ev.type === "error") return; // silent; not cached
      }
      log.debug("prefetch done", { url });
    } catch (err) {
      log.debug("prefetch failed", { url, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { readChapter, prefetch };
}
