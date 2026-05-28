import { describe, it, expect } from "vitest";
import { estimateTokens, chunkByBudget } from "./chunk.js";

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkByBudget", () => {
  it("keeps small text as a single chunk", () => {
    const text = "Para one.\n\nPara two.";
    expect(chunkByBudget(text, 1000)).toEqual([text]);
  });

  it("splits on paragraph boundaries when over budget and preserves order", () => {
    const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ` + "x".repeat(40));
    const text = paras.join("\n\n");
    // maxTokens small so each chunk holds ~1-2 paragraphs
    const chunks = chunkByBudget(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // re-joining chunks reproduces the original paragraph stream in order
    expect(chunks.join("\n\n")).toBe(text);
    // never cuts inside a paragraph
    for (const c of chunks) expect(c).not.toMatch(/x{40}\S/);
  });

  it("emits an over-budget single paragraph as its own chunk (never mid-sentence)", () => {
    const huge = "y".repeat(400);
    const chunks = chunkByBudget(huge, 10);
    expect(chunks).toEqual([huge]);
  });
});
