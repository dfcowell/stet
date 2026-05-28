import { describe, it, expect } from "vitest";
import { FakeLlmClient } from "./fakeLlm.js";

describe("FakeLlmClient", () => {
  it("streams scripted deltas for streamEdit", async () => {
    const llm = new FakeLlmClient({ editDeltas: ["Hello ", "world"] });
    const out: string[] = [];
    for await (const d of llm.streamEdit({
      system: "s", userText: "u", model: "m", maxTokens: 10, temperature: 1,
    })) out.push(d);
    expect(out.join("")).toBe("Hello world");
    expect(llm.lastStreamArgs?.system).toBe("s");
  });

  it("returns the scripted index for selectLink", async () => {
    const llm = new FakeLlmClient({ selectIndex: 2 });
    const idx = await llm.selectLink({
      instruction: "pick next", pageTitle: "T",
      links: [
        { title: "a", url: "u1", index: 0 },
        { title: "b", url: "u2", index: 1 },
        { title: "c", url: "u3", index: 2 },
      ],
      model: "m",
    });
    expect(idx).toBe(2);
  });
});
