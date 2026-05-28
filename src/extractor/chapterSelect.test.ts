import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { chaptersFromSelect } from "./chapterSelect.js";

describe("chaptersFromSelect", () => {
  it("reconstructs chapter URLs from a nav <select> by substituting the current id", () => {
    const html = `<body><select id="selected_id">
      <option value="880001">1. First</option>
      <option value="880002" selected>2. Second</option>
      <option value="880003">3. Third</option>
    </select></body>`;
    const base = "https://s.example/works/9/chapters/880002";
    const doc = new JSDOM(html, { url: base }).window.document;
    const links = chaptersFromSelect(doc, base);
    expect(links).not.toBeNull();
    expect(links!.map((l) => l.url)).toEqual([
      "https://s.example/works/9/chapters/880001",
      "https://s.example/works/9/chapters/880002",
      "https://s.example/works/9/chapters/880003",
    ]);
    expect(links![0]).toMatchObject({ title: "1. First", index: 0 });
  });

  it("returns null for a select whose options aren't part of the URL", () => {
    const html = `<body><select><option value="red">Red</option><option value="blue">Blue</option><option value="green">Green</option></select></body>`;
    const base = "https://s.example/works/9/chapters/880002";
    const doc = new JSDOM(html, { url: base }).window.document;
    expect(chaptersFromSelect(doc, base)).toBeNull();
  });

  it("ignores selects smaller than the minimum", () => {
    const html = `<body><select><option value="880002">only</option></select></body>`;
    const base = "https://s.example/works/9/chapters/880002";
    const doc = new JSDOM(html, { url: base }).window.document;
    expect(chaptersFromSelect(doc, base)).toBeNull();
  });
});
