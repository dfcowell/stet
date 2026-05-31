import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createAdapterStore } from "./adapters.js";
import { createExtractor } from "../extractor/index.js";

// Path to the real config/adapters/ directory at repo root. These tests load
// the JSON files that ship in the repo (and the container image), so editing
// or deleting a bundled adapter changes their behavior.
const adaptersDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../config/adapters");

describe("bundled site adapters", () => {
  it("ao3: serialTitle and chapterTitle resolve to their AO3 elements", async () => {
    const store = createAdapterStore({ dir: adaptersDir, watch: false });
    const adapter = store.forDomain("archiveofourown.org");
    expect(adapter?.selectors?.serialTitle).toBe("h2.title.heading");
    expect(adapter?.selectors?.chapterTitle).toBe("h3.title");

    const extractor = createExtractor({ model: "m" });
    const html = `<!doctype html><html><head><title>Wrong Title - Archive of Our Own</title></head>
      <body>
        <div id="header"><h1 class="heading"><a href="/">Archive of Our Own</a></h1></div>
        <div id="main">
          <h2 class="landmark heading">Work Header</h2>
          <h2 class="title heading">My Brilliant Work</h2>
          <div id="chapters">
            <h3 class="title">Chapter 5: The Plunge</h3>
            <div class="userstuff">${"<p>Prose paragraph with enough words for readability here.</p>".repeat(30)}</div>
          </div>
        </div>
      </body></html>`;
    const r = await extractor.extract({
      html,
      sourceUrl: "https://archiveofourown.org/works/1/chapters/2",
      adapter,
    });
    expect(r.serialTitle).toBe("My Brilliant Work");
    expect(r.title).toBe("Chapter 5: The Plunge");
    store.close();
  });

  it("ao3: chapterTitle selector falls through to heuristic when absent (single-chapter work)", async () => {
    const store = createAdapterStore({ dir: adaptersDir, watch: false });
    const adapter = store.forDomain("archiveofourown.org");
    const extractor = createExtractor({ model: "m" });
    const html = `<!doctype html><html><head><title>A Story</title></head>
      <body>
        <div id="main">
          <h2 class="title heading">A Single-Chapter Work</h2>
          <div class="userstuff">${"<p>Prose paragraph with enough words for readability here.</p>".repeat(30)}</div>
        </div>
      </body></html>`;
    const r = await extractor.extract({
      html,
      sourceUrl: "https://archiveofourown.org/works/2",
      adapter,
    });
    expect(r.serialTitle).toBe("A Single-Chapter Work");
    // No h3.title on a single-chapter page → fall through to the content heading
    // (which is the work title; reader will look the same as a single-chapter work
    // typically does on AO3 — no separate chapter heading).
    expect(r.title).toBe("A Single-Chapter Work");
    store.close();
  });

  it("ao3 adapter is matched for both apex and www hostnames", () => {
    const store = createAdapterStore({ dir: adaptersDir, watch: false });
    expect(store.forDomain("archiveofourown.org")?.domain).toBe("archiveofourown.org");
    expect(store.forDomain("www.archiveofourown.org")?.domain).toBe("archiveofourown.org");
    store.close();
  });
});
