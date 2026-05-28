import { describe, it, expect, afterEach } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test/helpers/fixtureServer.js";
import { createExtractor } from "../extractor/index.js";
import { httpFetch } from "../fetcher/httpFetch.js";
import { registerSerial } from "./register.js";
import type { Fetcher, AdapterStore } from "../types.js";

const noAdapters: AdapterStore = { forDomain: () => undefined, onChange: () => () => {}, close: () => {} };
const httpOnlyFetcher: Fetcher = {
  async fetch(url) {
    const r = await httpFetch(url);
    return { html: r.html, finalUrl: r.finalUrl, status: r.status, usedBrowser: false };
  },
  async close() {},
};
const deps = () => ({ fetcher: httpOnlyFetcher, extractor: createExtractor({ model: "m" }), adapters: noAdapters });
const body = (h1: string) => `<article><h1>${h1}</h1>${"<p>Prose with enough words for readability here.</p>".repeat(40)}</article>`;

let server: FixtureServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("registerSerial", () => {
  it("registers a single chapter without walking; nav is left to the reader", async () => {
    server = await startFixtureServer({
      "/c/5": { body: `<html><head><link rel=next href="/c/6"><link rel=prev href="/c/4"></head><body>${body("Chapter Five")}</body></html>` },
    });
    const story = await registerSerial(`${server.url}/c/5`, deps());
    expect(story.chapters).toEqual([]); // no eager chapter list for a plain chapter
    expect(story.indexUrl).toBeNull();
    expect(story.progress.currentChapterUrl).toBe(`${server.url}/c/5`);
    expect(story.title.toLowerCase()).toContain("chapter five");
    expect(story.sourceDomain).toBe("127.0.0.1");
  });

  it("captures the chapter list when the URL is an index page", async () => {
    const items = Array.from({ length: 6 }, (_, i) => `<a href="/c/${i + 1}">Chapter ${i + 1}</a>`).join("");
    server = await startFixtureServer({ "/toc": { body: `<html><body><ul>${items}</ul></body></html>` } });
    const story = await registerSerial(`${server.url}/toc`, deps());
    expect(story.chapters).toHaveLength(6);
    expect(story.indexUrl).toBe(`${server.url}/toc`);
    expect(story.progress.currentChapterUrl).toBe(`${server.url}/c/1`);
  });

  it("captures a chapter-nav <select> list while keeping the added chapter as current (AO3-style)", async () => {
    const select = `<select id="selected_id">
      <option value="880001">1. First</option>
      <option value="880002" selected>2. Second</option>
      <option value="880003">3. Third</option>
    </select>`;
    server = await startFixtureServer({
      "/works/9/chapters/880002": { body: `<html><body>${body("Two")}${select}</body></html>` },
    });
    const story = await registerSerial(`${server.url}/works/9/chapters/880002`, deps());
    expect(story.chapters.map((c) => c.url)).toEqual([
      `${server.url}/works/9/chapters/880001`,
      `${server.url}/works/9/chapters/880002`,
      `${server.url}/works/9/chapters/880003`,
    ]);
    expect(story.indexUrl).toBeNull(); // a chapter page, not an index
    expect(story.progress.currentChapterUrl).toBe(`${server.url}/works/9/chapters/880002`);
  });

  it("makes exactly one fetch — no chapter walk", async () => {
    let calls = 0;
    const counting: Fetcher = {
      async fetch(url) {
        calls++;
        const r = await httpFetch(url);
        return { html: r.html, finalUrl: r.finalUrl, status: r.status, usedBrowser: false };
      },
      async close() {},
    };
    server = await startFixtureServer({
      "/c/5": { body: `<html><head><link rel=next href="/c/6"><link rel=prev href="/c/4"></head><body>${body("Five")}</body></html>` },
    });
    await registerSerial(`${server.url}/c/5`, { fetcher: counting, extractor: createExtractor({ model: "m" }), adapters: noAdapters });
    expect(calls).toBe(1);
  });
});
