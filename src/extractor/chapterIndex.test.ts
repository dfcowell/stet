import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { detectChapterIndex } from "./chapterIndex.js";

describe("detectChapterIndex", () => {
  it("returns an ordered list when many same-domain chapter links exist", () => {
    const items = Array.from({ length: 8 }, (_, i) => `<a href="/story/ch-${i + 1}">Chapter ${i + 1}</a>`).join("");
    const doc = new JSDOM(`<body><ul>${items}</ul></body>`, { url: "https://s.example/toc" }).window.document;
    const links = detectChapterIndex(doc, "https://s.example/toc");
    expect(links).not.toBeNull();
    expect(links!.length).toBe(8);
    expect(links![0]).toMatchObject({ url: "https://s.example/story/ch-1", index: 0 });
  });

  it("returns null when there is no chapter-like list", () => {
    const doc = new JSDOM(`<body><a href="/a">A</a><a href="/b">B</a></body>`, { url: "https://s.example/p" }).window.document;
    expect(detectChapterIndex(doc, "https://s.example/p")).toBeNull();
  });
});
