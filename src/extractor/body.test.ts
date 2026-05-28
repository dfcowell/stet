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
});
