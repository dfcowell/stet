import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ExtractedChapter, Profile, ChapterCacheEntry, EditEvent, LlmClient,
} from "./types.js";

describe("types contract", () => {
  it("EditEvent is a discriminated union on `type`", () => {
    const e: EditEvent = { type: "delta", text: "hi" };
    expect(e.type).toBe("delta");
  });

  it("structural shapes compile", () => {
    expectTypeOf<ExtractedChapter>().toHaveProperty("navConfidence");
    expectTypeOf<Profile>().toHaveProperty("promptHash");
    expectTypeOf<ChapterCacheEntry>().toHaveProperty("rawExtractedText");
    expectTypeOf<LlmClient>().toHaveProperty("streamEdit");
    expect(true).toBe(true);
  });
});
