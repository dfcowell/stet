import { describe, it, expect } from "vitest";
import { extractBody } from "./body.js";

const article = `<!doctype html><html><head><title>Site</title></head><body>
  <nav>menu junk</nav>
  <article><h1>Chapter Five</h1>
    <p>First paragraph of real prose that is reasonably long for Readability.</p>
    <p>Second paragraph continues the scene with more words and detail here.</p>
  </article></body></html>`;

describe("extractBody", () => {
  it("pulls title and paragraphs joined by blank lines", () => {
    const r = extractBody(article, "https://s.example/c/5", undefined);
    expect(r.title.toLowerCase()).toContain("chapter five");
    expect(r.rawText).toContain("First paragraph");
    expect(r.rawText).toContain("\n\n");
    expect(r.rawText).not.toContain("menu junk");
  });

  it("honors an adapter body selector", () => {
    const html = `<body><div class="content"><p>Selected prose paragraph one here.</p><p>And two.</p></div><div>ignore me</div></body>`;
    const r = extractBody(html, "https://s.example/c/5", { domain: "s.example", selectors: { body: ".content" } });
    expect(r.rawText).toContain("Selected prose");
    expect(r.rawText).not.toContain("ignore me");
  });

  it("prefers a content heading over a site-banner h1 (AO3-style)", () => {
    const html = `<!doctype html><html><head><title>Archive of Our Own</title></head><body>
      <div id="header"><h1 class="heading"><a href="/">Archive of Our Own</a></h1></div>
      <div id="main"><h2 class="landmark heading">Work Header</h2>
        <h2 class="title heading">A Real Work Title</h2>
        <div class="userstuff">${"<p>Prose paragraph with enough words for readability here.</p>".repeat(30)}</div>
      </div></body></html>`;
    const r = extractBody(html, "https://archiveofourown.org/works/1/chapters/2", undefined);
    expect(r.title).toBe("A Real Work Title");
  });

  it("uses og:title when present", () => {
    const html = `<!doctype html><html><head><meta property="og:title" content="OG Work Title"><title>Site Name</title></head>
      <body><header><h1>Site Name</h1></header><article><h1>Some Heading</h1>${"<p>Prose with sufficient length for parsing.</p>".repeat(30)}</article></body></html>`;
    const r = extractBody(html, "https://s.example/c/5", undefined);
    expect(r.title).toBe("OG Work Title");
  });

  it("honors an adapter chapterTitle selector over heuristics", () => {
    const html = `<!doctype html><html><head><meta property="og:title" content="Bad OG Title"></head>
      <body><h2 class="ch">Real Chapter Title</h2>
      <article>${"<p>Prose paragraph with enough words to keep readability happy here.</p>".repeat(30)}</article></body></html>`;
    const r = extractBody(html, "https://s.example/c/5", {
      domain: "s.example",
      selectors: { chapterTitle: "h2.ch" },
    });
    expect(r.title).toBe("Real Chapter Title");
  });
});
