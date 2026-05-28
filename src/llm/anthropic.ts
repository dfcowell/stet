import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, ChapterLink } from "../types.js";

// The slice of the SDK we use, so tests can inject a fake.
export interface MessagesApi {
  create(params: any): Promise<any>;
}

export class AnthropicClient implements LlmClient {
  private readonly messages: MessagesApi;

  constructor(deps?: { messages?: MessagesApi; apiKey?: string }) {
    this.messages =
      deps?.messages ?? new Anthropic({ apiKey: deps?.apiKey }).messages;
  }

  async *streamEdit(args: {
    system: string; userText: string; model: string;
    maxTokens: number; temperature: number;
  }): AsyncIterable<string> {
    const stream = await this.messages.create({
      model: args.model,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      stream: true,
      system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: args.userText }],
    });
    for await (const event of stream as AsyncIterable<any>) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield event.delta.text as string;
      }
    }
  }

  async selectLink(args: {
    instruction: string; pageTitle: string; links: ChapterLink[]; model: string;
  }): Promise<number | null> {
    const menu = args.links
      .map((l, i) => `${i}: ${l.title} (${l.url})`)
      .join("\n");
    const res = await this.messages.create({
      model: args.model,
      max_tokens: 16,
      temperature: 0,
      system: [{
        type: "text",
        text:
          "You select a link by its number from a fixed list. " +
          "Reply with ONLY the number, or the word none. Never invent a URL.",
      }],
      messages: [{
        role: "user",
        content: `Page: ${args.pageTitle}\nTask: ${args.instruction}\nLinks:\n${menu}`,
      }],
    });
    const text: string = (res.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const m = text.match(/\d+/);
    if (!m) return null;
    const idx = Number(m[0]);
    return idx >= 0 && idx < args.links.length ? idx : null;
  }
}
