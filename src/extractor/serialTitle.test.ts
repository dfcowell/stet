import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { extractSerialTitle } from "./serialTitle.js";

const doc = (html: string, url = "https://s.example/c/5") =>
  new JSDOM(html, { url }).window.document;

describe("extractSerialTitle", () => {
  it("uses adapter selector first even when heuristics would also match", () => {
    const d = doc(`<html><head>
      <meta property="og:novel:novel_name" content="Heuristic Title">
      </head><body><h1 class="series">Adapter Title</h1></body></html>`);
    expect(
      extractSerialTitle(d, "Chapter Five", { serialTitle: "h1.series" }, "https://s.example/c/5"),
    ).toBe("Adapter Title");
  });

  it("uses og:novel:novel_name when no adapter override", () => {
    const d = doc(`<html><head><meta property="og:novel:novel_name" content="Hero Stories"></head></html>`);
    expect(extractSerialTitle(d, "Chapter Five", undefined, "https://s.example/c/5")).toBe("Hero Stories");
  });

  it("uses article:series", () => {
    const d = doc(`<html><head><meta property="article:series" content="The Wandering Inn"></head></html>`);
    expect(extractSerialTitle(d, "1.01 (Pilot)", undefined, "https://s.example/c/5")).toBe("The Wandering Inn");
  });

  it("uses book:series as an alternative", () => {
    const d = doc(`<html><head><meta property="book:series" content="A Series"></head></html>`);
    expect(extractSerialTitle(d, "Ch 1", undefined, "https://s.example/c/5")).toBe("A Series");
  });

  it("uses breadcrumb penultimate item (anchor + span shape)", () => {
    const d = doc(`<html><body>
      <nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/series/worm">Worm</a><span>Chapter 1</span></nav>
    </body></html>`);
    expect(extractSerialTitle(d, "Chapter 1", undefined, "https://s.example/c/5")).toBe("Worm");
  });

  it("uses breadcrumb penultimate item (list-item shape)", () => {
    const d = doc(`<html><body>
      <nav class="breadcrumb"><ol><li>Home</li><li>Pact</li><li>Bonds</li></ol></nav>
    </body></html>`);
    expect(extractSerialTitle(d, "Bonds", undefined, "https://s.example/c/5")).toBe("Pact");
  });

  it("splits <title> on dash separators and picks the non-chapter part", () => {
    const d = doc(`<html><head><title>Chapter 5: The Plunge - Worm</title></head></html>`);
    expect(extractSerialTitle(d, "Chapter 5: The Plunge", undefined, "https://s.example/c/5")).toBe("Worm");
  });

  it("splits <title> on pipe separators", () => {
    const d = doc(`<html><head><title>Worm | Chapter 5</title></head></html>`);
    expect(extractSerialTitle(d, "Chapter 5", undefined, "https://s.example/c/5")).toBe("Worm");
  });

  it("falls back to og:site_name when it isn't just the hostname", () => {
    const d = doc(`<html><head>
      <meta property="og:site_name" content="Royal Road">
      <title></title></head></html>`, "https://www.royalroad.com/fiction/1/c/5");
    expect(extractSerialTitle(d, "Chapter 5", undefined, "https://www.royalroad.com/fiction/1/c/5")).toBe("Royal Road");
  });

  it("rejects og:site_name that equals the hostname", () => {
    const d = doc(`<html><head>
      <meta property="og:site_name" content="s.example">
      <title></title></head></html>`);
    expect(extractSerialTitle(d, "Chapter 5", undefined, "https://s.example/c/5")).toBeNull();
  });

  it("returns null when nothing produces a non-trivial title", () => {
    const d = doc(`<html><head><title></title></head><body></body></html>`);
    expect(extractSerialTitle(d, "Chapter 5", undefined, "https://s.example/c/5")).toBeNull();
  });

  it("rejects title parts that are chapter-numeric", () => {
    const d = doc(`<html><head><title>Chapter 5 | Part 2</title></head></html>`);
    expect(extractSerialTitle(d, "Chapter 5", undefined, "https://s.example/c/5")).toBeNull();
  });

  it("rejects title parts that equal the chapter title", () => {
    const d = doc(`<html><head><title>Some Heading - Some Heading</title></head></html>`);
    expect(extractSerialTitle(d, "Some Heading", undefined, "https://s.example/c/5")).toBeNull();
  });

  it("ignores an adapter selector that matches nothing and falls through", () => {
    const d = doc(`<html><head><meta property="article:series" content="Real Title"></head></html>`);
    expect(
      extractSerialTitle(d, "Ch 1", { serialTitle: ".missing" }, "https://s.example/c/5"),
    ).toBe("Real Title");
  });
});
