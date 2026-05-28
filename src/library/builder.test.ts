import { describe, it, expect, afterEach } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test/helpers/fixtureServer.js";
import { createExtractor } from "../extractor/index.js";
import { httpFetch } from "../fetcher/httpFetch.js";
import { buildStory } from "./builder.js";
import type { Fetcher } from "../types.js";

// A tiny Fetcher that only does HTTP (no browser) — sufficient for fixtures.
const httpOnlyFetcher: Fetcher = {
  async fetch(url) { const r = await httpFetch(url); return { html: r.html, finalUrl: r.finalUrl, status: r.status, usedBrowser: false }; },
  async close() {},
};

let server: FixtureServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const body = (h1: string) => `<article><h1>${h1}</h1>${"<p>Prose with enough words for readability here.</p>".repeat(40)}</article>`;

describe("buildStory", () => {
  it("walks prev/next links into an ordered chapter list", async () => {
    server = await startFixtureServer({
      "/c/1": { body: `<html><head><link rel=next href="/c/2"></head><body>${body("Chapter 1")}</body></html>` },
      "/c/2": { body: `<html><head><link rel=prev href="/c/1"><link rel=next href="/c/3"></head><body>${body("Chapter 2")}</body></html>` },
      "/c/3": { body: `<html><head><link rel=prev href="/c/2"></head><body>${body("Chapter 3")}</body></html>` },
    });
    const story = await buildStory(`${server.url}/c/2`, {
      fetcher: httpOnlyFetcher, extractor: createExtractor({ model: "m" }), adapters: { forDomain: () => undefined, onChange: () => () => {}, close: () => {} },
    }, { maxChapters: 20 });

    expect(story.chapters.map((c) => c.url)).toEqual([
      `${server.url}/c/1`, `${server.url}/c/2`, `${server.url}/c/3`,
    ]);
    expect(story.chapters[0]!.index).toBe(0);
    expect(story.sourceDomain).toBe("127.0.0.1");
    expect(story.progress.currentChapterUrl).toBe(`${server.url}/c/1`);
  });

  it("uses an index page's chapterLinks directly when present", async () => {
    const items = Array.from({ length: 6 }, (_, i) => `<a href="/c/${i + 1}">Chapter ${i + 1}</a>`).join("");
    server = await startFixtureServer({ "/toc": { body: `<html><body><ul>${items}</ul></body></html>` } });
    const story = await buildStory(`${server.url}/toc`, {
      fetcher: httpOnlyFetcher, extractor: createExtractor({ model: "m" }), adapters: { forDomain: () => undefined, onChange: () => () => {}, close: () => {} },
    }, { maxChapters: 20 });
    expect(story.chapters).toHaveLength(6);
    expect(story.indexUrl).toBe(`${server.url}/toc`);
  });
});
