import type { LlmClient, ChapterLink } from "../../src/types.js";

interface FakeConfig {
  editDeltas?: string[];
  selectIndex?: number | null;
}

export class FakeLlmClient implements LlmClient {
  lastStreamArgs?: { system: string; userText: string; model: string };
  lastSelectArgs?: { instruction: string; links: ChapterLink[] };
  constructor(private readonly cfg: FakeConfig = {}) {}

  async *streamEdit(args: {
    system: string; userText: string; model: string;
    maxTokens: number; temperature: number;
  }): AsyncIterable<string> {
    this.lastStreamArgs = { system: args.system, userText: args.userText, model: args.model };
    const deltas = this.cfg.editDeltas ?? [args.userText];
    for (const d of deltas) yield d;
  }

  async selectLink(args: {
    instruction: string; pageTitle: string; links: ChapterLink[]; model: string;
  }): Promise<number | null> {
    this.lastSelectArgs = { instruction: args.instruction, links: args.links };
    return this.cfg.selectIndex ?? null;
  }
}
