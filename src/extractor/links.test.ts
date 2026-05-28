import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { collectLinks, sameRegistrableDomain, relHints } from "./links.js";

const html = `<!doctype html><html><head>
  <link rel="next" href="/c/2"><link rel="prev" href="/c/0">
  </head><body>
  <a href="/c/2">Next Chapter ›</a>
  <a href="https://other.example/x">Offsite</a>
  <a href="/c/0">Previous</a>
  <a href="#top">Top</a>
</body></html>`;

const doc = new JSDOM(html, { url: "https://site.example/c/1" }).window.document;

describe("collectLinks", () => {
  it("resolves to absolute urls and drops empty/hash-only", () => {
    const links = collectLinks(doc, "https://site.example/c/1");
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://site.example/c/2");
    expect(urls).toContain("https://other.example/x");
    expect(urls).not.toContain("https://site.example/c/1#top");
  });
});

describe("relHints", () => {
  it("reads <link rel=next/prev> and a[rel]", () => {
    const h = relHints(doc, "https://site.example/c/1");
    expect(h.next).toBe("https://site.example/c/2");
    expect(h.prev).toBe("https://site.example/c/0");
  });
});

describe("sameRegistrableDomain", () => {
  it("treats subdomains of the same site as same", () => {
    expect(sameRegistrableDomain("https://www.site.example/a", "https://site.example/b")).toBe(true);
    expect(sameRegistrableDomain("https://other.example/a", "https://site.example/b")).toBe(false);
  });
});
