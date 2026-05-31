import { describe, it, expect } from "vitest";
import { mergeStoryMetadata } from "./mergeMetadata.js";
import type { Story, ChapterLink } from "../types.js";

const chap = (i: number): ChapterLink => ({ title: `Chapter ${i}`, url: `https://s/c/${i}`, index: i });

const baseStory = (over: Partial<Story> = {}): Story => ({
  id: "s.example/c/5",
  title: "Old Title",
  sourceDomain: "s.example",
  indexUrl: null,
  chapters: [],
  progress: { currentChapterUrl: "https://s/c/5", lastReadAt: null },
  ...over,
});

describe("mergeStoryMetadata", () => {
  it("replaces chapters when fresh list is strictly longer", () => {
    const stored = baseStory({ chapters: [chap(1), chap(2)] });
    const merged = mergeStoryMetadata(stored, {
      title: null, indexUrl: null, chapters: [chap(1), chap(2), chap(3), chap(4)],
    });
    expect(merged.chapters).toHaveLength(4);
  });

  it("keeps stored chapters when fresh list is the same length or shorter", () => {
    const stored = baseStory({ chapters: [chap(1), chap(2), chap(3)] });
    const sameLen = mergeStoryMetadata(stored, { title: null, indexUrl: null, chapters: [chap(1), chap(2), chap(3)] });
    expect(sameLen.chapters).toEqual(stored.chapters);
    const shorter = mergeStoryMetadata(stored, { title: null, indexUrl: null, chapters: [chap(1)] });
    expect(shorter.chapters).toEqual(stored.chapters);
  });

  it("populates chapters when stored list was empty", () => {
    const stored = baseStory({ chapters: [] });
    const merged = mergeStoryMetadata(stored, { title: null, indexUrl: null, chapters: [chap(1)] });
    expect(merged.chapters).toEqual([chap(1)]);
  });

  it("adopts a fresh indexUrl when stored has none", () => {
    const stored = baseStory({ indexUrl: null });
    const merged = mergeStoryMetadata(stored, { title: null, indexUrl: "https://s/toc", chapters: [] });
    expect(merged.indexUrl).toBe("https://s/toc");
  });

  it("never overwrites a known indexUrl", () => {
    const stored = baseStory({ indexUrl: "https://s/old-toc" });
    const merged = mergeStoryMetadata(stored, { title: null, indexUrl: "https://s/new-toc", chapters: [] });
    expect(merged.indexUrl).toBe("https://s/old-toc");
  });

  it("adopts a fresh non-trivial title", () => {
    const stored = baseStory({ title: "Old Title" });
    const merged = mergeStoryMetadata(stored, { title: "Brand New Title", indexUrl: null, chapters: [] });
    expect(merged.title).toBe("Brand New Title");
  });

  it("does not overwrite the stored title when fresh title is null", () => {
    const stored = baseStory({ title: "Good Title" });
    const merged = mergeStoryMetadata(stored, { title: null, indexUrl: null, chapters: [] });
    expect(merged.title).toBe("Good Title");
  });

  it("does not overwrite with a trivial title (empty / whitespace)", () => {
    const stored = baseStory({ title: "Good Title" });
    const merged = mergeStoryMetadata(stored, { title: "   ", indexUrl: null, chapters: [] });
    expect(merged.title).toBe("Good Title");
  });

  it("does not overwrite with a title equal to the source domain", () => {
    const stored = baseStory({ title: "Good Title", sourceDomain: "s.example" });
    const merged = mergeStoryMetadata(stored, { title: "s.example", indexUrl: null, chapters: [] });
    expect(merged.title).toBe("Good Title");
  });

  it("does not overwrite with a chapter-numeric title", () => {
    const stored = baseStory({ title: "Good Title" });
    const merged = mergeStoryMetadata(stored, { title: "Chapter 5", indexUrl: null, chapters: [] });
    expect(merged.title).toBe("Good Title");
  });

  it("preserves id, sourceDomain, and progress", () => {
    const stored = baseStory({
      id: "abc", sourceDomain: "s.example",
      progress: { currentChapterUrl: "https://s/c/9", lastReadAt: 12345 },
    });
    const merged = mergeStoryMetadata(stored, {
      title: "New Title", indexUrl: "https://s/toc", chapters: [chap(1), chap(2)],
    });
    expect(merged.id).toBe("abc");
    expect(merged.sourceDomain).toBe("s.example");
    expect(merged.progress).toEqual({ currentChapterUrl: "https://s/c/9", lastReadAt: 12345 });
  });

  it("returns the same object reference when nothing changes (cheap to no-op)", () => {
    const stored = baseStory({ title: "Stable", chapters: [chap(1)], indexUrl: "https://s/toc" });
    const merged = mergeStoryMetadata(stored, { title: null, indexUrl: null, chapters: [chap(1)] });
    expect(merged).toBe(stored);
  });
});
