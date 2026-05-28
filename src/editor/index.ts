import type { Editor, EditEvent, LlmClient, Profile } from "../types.js";
import { chunkByBudget } from "./chunk.js";

// Explicit, transform-agnostic request so the model reliably treats the user
// turn as the text to edit (many editorial prompts only act "when asked for a
// rewrite"). The system prompt still governs *how* to edit.
const INSTRUCTION =
  "Apply your editorial instructions to the text below and return the full edited prose only — no preamble, notes, or commentary.\n\n";

export function createEditor(deps: { llm: LlmClient; contextCarry?: boolean }): Editor {
  return {
    async *edit(rawText: string, profile: Profile): AsyncIterable<EditEvent> {
      const chunks = chunkByBudget(rawText, profile.maxTokens);
      const stitched: string[] = [];
      try {
        for (let i = 0; i < chunks.length; i++) {
          const carry =
            deps.contextCarry && i > 0
              ? `Previous text (for continuity, do not re-edit):\n${chunks[i - 1]!.slice(-500)}\n\n---\n\n`
              : "";
          let chunkFull = "";
          for await (const delta of deps.llm.streamEdit({
            system: profile.systemPrompt,
            userText: carry + INSTRUCTION + chunks[i]!,
            model: profile.model,
            maxTokens: profile.maxTokens,
            temperature: profile.temperature,
          })) {
            chunkFull += delta;
            yield { type: "delta", text: delta };
          }
          stitched.push(chunkFull);
          if (i < chunks.length - 1) yield { type: "delta", text: "\n\n" };
        }
        yield { type: "done", full: stitched.join("\n\n") };
      } catch (err) {
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
