import { describe, it, expect } from "vitest";
import { parseProfileFile } from "./profileFile.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "../config-defaults.js";

describe("parseProfileFile", () => {
  it("reads frontmatter and uses the body as the system prompt", () => {
    const content = `---\nname: Light Copyedit\nmodel: claude-opus-4-7\nmaxTokens: 4096\ntemperature: 0.7\n---\nFix grammar only. Keep voice.`;
    const p = parseProfileFile("light.md", content);
    expect(p).toMatchObject({
      id: "light", name: "Light Copyedit", model: "claude-opus-4-7",
      maxTokens: 4096, temperature: 0.7, systemPrompt: "Fix grammar only. Keep voice.",
    });
    expect(p.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to defaults and filename when no frontmatter", () => {
    const p = parseProfileFile("plain.md", "Just rewrite it.");
    expect(p).toMatchObject({
      id: "plain", name: "plain", model: DEFAULT_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS, temperature: DEFAULT_TEMPERATURE,
      systemPrompt: "Just rewrite it.",
    });
  });

  it("changes promptHash when the prompt or params change", () => {
    const a = parseProfileFile("p.md", "A");
    const b = parseProfileFile("p.md", "B");
    expect(a.promptHash).not.toBe(b.promptHash);
  });
});
