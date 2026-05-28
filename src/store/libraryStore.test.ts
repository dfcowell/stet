import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { createLibraryStore } from "./libraryStore.js";
import type { Story } from "../types.js";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1", title: "My Serial", sourceDomain: "s.example", indexUrl: "https://s.example/toc",
  chapters: [
    { title: "Chapter 1", url: "https://s.example/1", index: 0 },
    { title: "Chapter 2", url: "https://s.example/2", index: 1 },
  ],
  progress: { currentChapterUrl: null, lastReadAt: null }, ...over,
});

describe("LibraryStore", () => {
  it("upserts and lists stories, preserving chapters", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    expect(lib.listStories()).toEqual([]);
    lib.upsertStory(story());
    const got = lib.getStory("st1");
    expect(got?.title).toBe("My Serial");
    expect(got?.chapters).toHaveLength(2);
    expect(got?.chapters[1]).toMatchObject({ url: "https://s.example/2", index: 1 });
    expect(lib.listStories()).toHaveLength(1);
  });

  it("updates progress without disturbing chapters", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    lib.upsertStory(story());
    lib.setProgress("st1", "https://s.example/2", 1717000000000);
    const got = lib.getStory("st1");
    expect(got?.progress).toEqual({ currentChapterUrl: "https://s.example/2", lastReadAt: 1717000000000 });
    expect(got?.chapters).toHaveLength(2);
  });

  it("upsert overwrites an existing story", () => {
    const lib = createLibraryStore(openDb(":memory:"));
    lib.upsertStory(story());
    lib.upsertStory(story({ title: "Renamed" }));
    expect(lib.getStory("st1")?.title).toBe("Renamed");
    expect(lib.listStories()).toHaveLength(1);
  });
});
