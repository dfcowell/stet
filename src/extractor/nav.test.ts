import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { heuristicNav } from "./nav.js";

function nav(html: string, url = "https://s.example/c/5") {
  const doc = new JSDOM(html, { url }).window.document;
  return heuristicNav(doc, url);
}

describe("heuristicNav", () => {
  it("prefers rel=next/prev link tags (high confidence)", () => {
    const r = nav(`<head><link rel=next href="/c/6"><link rel=prev href="/c/4"></head><body></body>`);
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.prevUrl).toBe("https://s.example/c/4");
    expect(r.confidence).toBe("high");
  });

  it("falls back to link-text patterns", () => {
    const r = nav(`<body><a href="/c/6">Next Chapter »</a><a href="/c/4">« Previous</a></body>`);
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.prevUrl).toBe("https://s.example/c/4");
    expect(r.confidence).toBe("high");
  });

  it("reports low confidence when no next is found", () => {
    const r = nav(`<body><a href="/about">About</a></body>`);
    expect(r.nextUrl).toBeNull();
    expect(r.confidence).toBe("low");
  });
});
