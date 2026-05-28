import { describe, it, expect } from "vitest";
import { createEditor } from "./index.js";
import { FakeLlmClient } from "../../test/helpers/fakeLlm.js";
import type { LlmClient, ChapterLink, Profile, EditEvent } from "../../src/types.js";

const profile = (maxTokens: number): Profile => ({
  id: "p", name: "P", systemPrompt: "edit this", model: "m",
  maxTokens, temperature: 1, promptHash: "h",
});

async function collect(it: AsyncIterable<EditEvent>): Promise<EditEvent[]> {
  const out: EditEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("createEditor single pass", () => {
  it("streams deltas and ends with a done event carrying the full text", async () => {
    const llm = new FakeLlmClient({ editDeltas: ["Edited ", "prose."] });
    const editor = createEditor({ llm });
    const events = await collect(editor.edit("Short input.", profile(5000)));
    const deltas = events.filter((e) => e.type === "delta").map((e: any) => e.text);
    expect(deltas).toEqual(["Edited ", "prose."]);
    const done = events.at(-1)!;
    expect(done).toEqual({ type: "done", full: "Edited prose." });
  });

  it("passes the profile system prompt and model through to the LLM", async () => {
    const llm = new FakeLlmClient({ editDeltas: ["x"] });
    const editor = createEditor({ llm });
    await collect(editor.edit("hi", profile(5000)));
    expect(llm.lastStreamArgs?.system).toBe("edit this");
    expect(llm.lastStreamArgs?.model).toBe("m");
  });

  it("frames the user turn as an explicit edit request that includes the text", async () => {
    const llm = new FakeLlmClient({ editDeltas: ["x"] });
    const editor = createEditor({ llm });
    await collect(editor.edit("ORIGINAL PROSE", profile(5000)));
    expect(llm.lastStreamArgs?.userText).toContain("ORIGINAL PROSE");
    expect(llm.lastStreamArgs?.userText?.toLowerCase()).toContain("edited prose only");
  });
});

describe("createEditor multi-chunk", () => {
  it("edits each chunk and stitches them in order with blank lines", async () => {
    // Local fake: prefixes each chunk so we can prove multiple passes + order.
    let calls = 0;
    const fake: LlmClient = {
      async *streamEdit(args) { calls++; yield `[${calls}]` + args.userText.slice(0, 5); },
      async selectLink() { return null; },
    };
    const editor = createEditor({ llm: fake });
    const big = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ` + "z".repeat(40)).join("\n\n");
    const events = await collect(editor.edit(big, profile(20))); // tiny budget forces chunking
    expect(calls).toBeGreaterThan(1);
    const done: any = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.full).toContain("[1]");
    expect(done.full).toContain(`[${calls}]`);
    // chunks joined with blank lines
    expect(done.full.split("\n\n").length).toBe(calls);
  });

  it("emits an error event if the LLM throws", async () => {
    const fake: LlmClient = {
      async *streamEdit() { throw new Error("rate limit"); },
      async selectLink() { return null; },
    };
    const editor = createEditor({ llm: fake });
    const events = await collect(editor.edit("hi", profile(5000)));
    expect(events.at(-1)).toEqual({ type: "error", message: "rate limit" });
  });
});
