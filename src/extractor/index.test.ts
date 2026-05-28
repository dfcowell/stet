import { describe, it, expect } from "vitest";
import { createExtractor } from "./index.js";
import { FakeLlmClient } from "../../test/helpers/fakeLlm.js";

const base = "https://s.example/c/5";
const richBody = `<article><h1>Chapter Five</h1>${"<p>Real prose paragraph with enough words.</p>".repeat(6)}</article>`;

describe("createExtractor", () => {
  it("resolves nav via heuristics with high confidence (no LLM call)", async () => {
    const llm = new FakeLlmClient({ selectIndex: 0 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<head><link rel=next href="/c/6"></head><body><a href="/c/6">Next ›</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(r.navConfidence).toBe("high");
    expect(llm.lastSelectArgs).toBeUndefined(); // fallback not used
  });

  it("uses constrained LLM fallback when heuristics fail, selecting a real link only", async () => {
    // The model 'picks' index 1, which maps to /c/6 — a real on-page link.
    const llm = new FakeLlmClient({ selectIndex: 1 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<body><a href="/random">Random</a><a href="/c/6">Continue reading</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.navConfidence).toBe("low");
    expect(r.nextUrl).toBe("https://s.example/c/6");
    expect(llm.lastSelectArgs).toBeDefined();
  });

  it("rejects an LLM choice that is off-domain (hallucination/plausibility guard)", async () => {
    const llm = new FakeLlmClient({ selectIndex: 0 });
    const ex = createExtractor({ llm, model: "m" });
    const html = `<body><a href="https://evil.example/x">Continue</a>${richBody}</body>`;
    const r = await ex.extract({ html, sourceUrl: base });
    expect(r.nextUrl).toBeNull();
  });

  it("populates chapterLinks for an index page", async () => {
    const ex = createExtractor({ model: "m" }); // no llm needed
    const items = Array.from({ length: 6 }, (_, i) => `<a href="/c/${i + 1}">Chapter ${i + 1}</a>`).join("");
    const r = await ex.extract({ html: `<body><ul>${items}</ul></body>`, sourceUrl: "https://s.example/toc" });
    expect(r.chapterLinks.length).toBe(6);
    expect(r.indexUrl).toBe("https://s.example/toc");
  });
});
