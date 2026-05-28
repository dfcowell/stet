import { describe, it, expect } from "vitest";
import { AnthropicClient, type MessagesApi } from "./anthropic.js";

function fakeSdk(events: any[]): { messages: MessagesApi; calls: any[] } {
  const calls: any[] = [];
  const messages: MessagesApi = {
    async create(params: any) {
      calls.push(params);
      if (params.stream) {
        return (async function* () { for (const e of events) yield e; })();
      }
      return { content: [{ type: "text", text: "1" }] };
    },
  };
  return { messages, calls };
}

describe("AnthropicClient.streamEdit", () => {
  it("yields text deltas and sets cache_control on the system prompt", async () => {
    const { messages, calls } = fakeSdk([
      { type: "content_block_delta", delta: { type: "text_delta", text: "He" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "llo" } },
      { type: "message_stop" },
    ]);
    const client = new AnthropicClient({ messages });
    const out: string[] = [];
    for await (const d of client.streamEdit({
      system: "SYS", userText: "u", model: "m", maxTokens: 5, temperature: 1,
    })) out.push(d);

    expect(out.join("")).toBe("Hello");
    const sysParam = calls[0].system;
    expect(Array.isArray(sysParam)).toBe(true);
    expect(sysParam[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sysParam[0].text).toBe("SYS");
    expect(calls[0].stream).toBe(true);
  });
});

describe("AnthropicClient.selectLink", () => {
  it("parses the integer index and validates range", async () => {
    const { messages } = fakeSdk([]);
    (messages as any).create = async () => ({ content: [{ type: "text", text: "2" }] });
    const client = new AnthropicClient({ messages });
    const idx = await client.selectLink({
      instruction: "next", pageTitle: "T",
      links: [
        { title: "a", url: "u1", index: 0 },
        { title: "b", url: "u2", index: 1 },
        { title: "c", url: "u3", index: 2 },
      ],
      model: "m",
    });
    expect(idx).toBe(2);
  });

  it("returns null when the model replies out of range or non-numeric", async () => {
    const { messages } = fakeSdk([]);
    (messages as any).create = async () => ({ content: [{ type: "text", text: "none" }] });
    const client = new AnthropicClient({ messages });
    const idx = await client.selectLink({
      instruction: "next", pageTitle: "T",
      links: [{ title: "a", url: "u1", index: 0 }],
      model: "m",
    });
    expect(idx).toBeNull();
  });
});
