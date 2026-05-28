# stet Editor Implementation Plan (Wave 1 — C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem lives entirely under `src/editor`. Import contracts read-only from `src/types.ts`; in tests use `test/helpers/fakeLlm.ts` or a local fake `LlmClient`. Do NOT edit `package.json` or other subsystems' files.

**Goal:** Implement the `Editor` — run a profile's system prompt over a chapter via `LlmClient.streamEdit`, streaming `EditEvent`s. For long chapters that would exceed the output-token budget, split at paragraph boundaries into ordered chunks, edit each (streaming), and stitch in order. Optional context-carry, off by default.

**Architecture:** `createEditor({ llm, contextCarry? })` returns an `Editor`. `edit(rawText, profile)` estimates tokens; if within budget it does a single streaming pass, else it chunks via `chunkByBudget`. It yields `{type:"delta"}` for each text fragment, then `{type:"done", full}` with the stitched result; on any thrown error it yields `{type:"error", message}` and stops. Prompt caching lives in the real `AnthropicClient` (Foundation) — the Editor stays transport-agnostic via the `LlmClient` interface.

**Tech Stack:** none beyond `src/types.ts`.

**Contracts used (from `src/types.ts`):** `Editor`, `EditEvent`, `Profile`, `LlmClient`.

---

### Task 1: Token estimate + paragraph chunking (pure)

**Files:**
- Create: `src/editor/chunk.ts`
- Test: `src/editor/chunk.test.ts`

- [ ] **Step 1: Write failing test `src/editor/chunk.test.ts`**

```typescript
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
```

- [ ] **Step 2:** Run `npx vitest run src/editor/chunk.test.ts` → FAIL.

- [ ] **Step 3: Write `src/editor/chunk.ts`**

```typescript
const CHARS_PER_TOKEN = 4;
const SAFETY = 0.8; // leave headroom under the output-token budget

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkByBudget(rawText: string, maxOutputTokens: number): string[] {
  const budget = Math.max(1, Math.floor(maxOutputTokens * SAFETY));
  if (estimateTokens(rawText) <= budget) return [rawText];

  const paras = rawText.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paras) {
    const t = estimateTokens(para);
    if (current.length > 0 && currentTokens + t > budget) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(para);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/chunk.ts src/editor/chunk.test.ts
git commit -m "feat(editor): add token estimate and paragraph chunking"
```

---

### Task 2: Editor factory (stream single pass, then multi-chunk stitch)

**Files:**
- Create: `src/editor/index.ts`
- Test: `src/editor/index.test.ts`

- [ ] **Step 1: Write failing test `src/editor/index.test.ts`**

```typescript
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
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/editor/index.ts`**

```typescript
import type { Editor, EditEvent, LlmClient, Profile } from "../types.js";
import { chunkByBudget } from "./chunk.js";

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
            userText: carry + chunks[i]!,
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
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Run the whole editor suite + typecheck**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/editor/index.ts src/editor/index.test.ts
git commit -m "feat(editor): stream single-pass and chunked-stitch edits"
```

---

## Self-Review
1. **Spec coverage:** streaming output ✔; prompt caching (handled by `AnthropicClient`, exercised here via `LlmClient`) ✔; chunk at paragraph boundaries / never mid-sentence ✔; per-chunk stream + in-order stitch ✔; optional context-carry off by default ✔; surfaces errors so the server can fall back to raw text ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** `edit` returns `AsyncIterable<EditEvent>`; `EditEvent` variants (`delta`/`done`/`error`) match `src/types.ts`; reads `profile.maxTokens/model/temperature/systemPrompt` exactly as defined.
4. **No package.json edits**; only `src/editor/**`.
