# stet Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared trunk — TypeScript/Node scaffold, the authoritative type/interface contracts, SQLite open+migrate, the LLM client (+ fake), small utils, and test infra — so Wave 1 subsystems can be built in parallel worktrees without colliding.

**Architecture:** A single Node/TypeScript package. `src/types.ts` holds every shared type and component interface (the contract). `src/db` opens SQLite and applies an idempotent migration. `src/llm` wraps the Anthropic SDK (streaming + prompt caching) behind a small `LlmClient` interface with a `FakeLlmClient` for tests. `src/util` holds hashing + cache-key helpers. `test/helpers` provides a local fixture HTTP server and the fake LLM. Everything here is imported read-only by Wave 1.

**Tech Stack:** TypeScript, tsx, vitest, better-sqlite3, @anthropic-ai/sdk, Node 24 (built-in fetch). (Other runtime deps are installed now but exercised in later waves.)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "stet",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@hono/node-server": "^1.13.0",
    "@mozilla/readability": "^0.5.0",
    "better-sqlite3": "^11.8.0",
    "chokidar": "^4.0.0",
    "hono": "^4.6.0",
    "jsdom": "^25.0.0",
    "playwright": "^1.50.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/jsdom": "^21.1.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Append to `.gitignore`**

```
node_modules/
dist/
*.sqlite
*.sqlite-journal
data/
.env
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/` populated; `package-lock.json` written.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold stet TypeScript/Node project"
```

---

### Task 2: Shared types and interfaces (the contract)

**Files:**
- Create: `src/types.ts`
- Create: `src/config-defaults.ts`
- Test: `src/types.test.ts`

- [ ] **Step 1: Write `src/config-defaults.ts`**

```typescript
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_TEMPERATURE = 1;
```

- [ ] **Step 2: Write `src/types.ts`** (copy the contract block verbatim from the roadmap)

Copy the entire `Shared Interface Contracts (src/types.ts)` TypeScript block from
`docs/superpowers/plans/2026-05-28-stet-roadmap.md` into `src/types.ts`. It defines:
`ChapterLink`, `ExtractedChapter`, `Profile`, `GateStep`, `SiteAdapter`,
`ChapterCacheEntry`, `RawChapter`, `Story`, `FetchResult`, `EditEvent`, `LlmClient`,
`Fetcher`, `Extractor`, `Editor`, `ProfileStore`, `AdapterStore`, `ChapterCache`,
`LibraryStore`.

- [ ] **Step 3: Write the failing test `src/types.test.ts`**

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ExtractedChapter, Profile, ChapterCacheEntry, EditEvent, LlmClient,
} from "./types.js";

describe("types contract", () => {
  it("EditEvent is a discriminated union on `type`", () => {
    const e: EditEvent = { type: "delta", text: "hi" };
    expect(e.type).toBe("delta");
  });

  it("structural shapes compile", () => {
    expectTypeOf<ExtractedChapter>().toHaveProperty("navConfidence");
    expectTypeOf<Profile>().toHaveProperty("promptHash");
    expectTypeOf<ChapterCacheEntry>().toHaveProperty("rawExtractedText");
    expectTypeOf<LlmClient>().toHaveProperty("streamEdit");
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes after types exist**

Run: `npm run typecheck && npx vitest run src/types.test.ts`
Expected: typecheck passes; test PASS. (If `navConfidence`/`promptHash` missing, this fails — fix `src/types.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config-defaults.ts src/types.test.ts
git commit -m "feat: add shared type and interface contracts"
```

---

### Task 3: Hashing + cache-key utils

**Files:**
- Create: `src/util/hash.ts`
- Create: `src/util/cacheKey.ts`
- Test: `src/util/cacheKey.test.ts`

- [ ] **Step 1: Write the failing test `src/util/cacheKey.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { sha256 } from "./hash.js";
import { computeCacheKey } from "./cacheKey.js";

describe("sha256", () => {
  it("is deterministic and hex", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });
});

describe("computeCacheKey", () => {
  const base = { url: "https://x/1", profileId: "p", promptHash: "h", model: "m" };
  it("is stable for same inputs", () => {
    expect(computeCacheKey(base)).toBe(computeCacheKey({ ...base }));
  });
  it("changes when any field changes", () => {
    expect(computeCacheKey(base)).not.toBe(computeCacheKey({ ...base, model: "m2" }));
    expect(computeCacheKey(base)).not.toBe(computeCacheKey({ ...base, promptHash: "h2" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/util/cacheKey.test.ts`
Expected: FAIL — cannot find `./hash.js` / `./cacheKey.js`.

- [ ] **Step 3: Write `src/util/hash.ts`**

```typescript
import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
```

- [ ] **Step 4: Write `src/util/cacheKey.ts`**

```typescript
import { sha256 } from "./hash.js";

export function computeCacheKey(args: {
  url: string;
  profileId: string;
  promptHash: string;
  model: string;
}): string {
  return sha256(`${args.url}\n${args.profileId}\n${args.promptHash}\n${args.model}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/util/cacheKey.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/util/hash.ts src/util/cacheKey.ts src/util/cacheKey.test.ts
git commit -m "feat: add sha256 and cache-key helpers"
```

---

### Task 4: SQLite open + migrations

**Files:**
- Create: `src/db/migrations.ts`
- Create: `src/db/index.ts`
- Test: `src/db/index.test.ts`

- [ ] **Step 1: Write the failing test `src/db/index.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "./index.js";

describe("openDb", () => {
  it("creates schema and is idempotent on re-open", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["chapter_cache", "raw_chapter", "story"]),
    );
    // running migrations again must not throw
    expect(() => openDb(":memory:")).not.toThrow();
    db.close();
  });

  it("sets user_version to the latest migration", () => {
    const db = openDb(":memory:");
    const v = db.pragma("user_version", { simple: true });
    expect(v).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/index.test.ts`
Expected: FAIL — cannot find `./index.js`.

- [ ] **Step 3: Write `src/db/migrations.ts`**

```typescript
import type Database from "better-sqlite3";

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS chapter_cache (
    key TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    edited_content TEXT NOT NULL,
    extracted_title TEXT NOT NULL,
    next_url TEXT,
    prev_url TEXT,
    raw_extracted_text TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS raw_chapter (
    url TEXT PRIMARY KEY,
    extracted_title TEXT NOT NULL,
    raw_extracted_text TEXT NOT NULL,
    next_url TEXT,
    prev_url TEXT,
    index_url TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS story (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_domain TEXT NOT NULL,
    index_url TEXT,
    chapters_json TEXT NOT NULL,
    current_chapter_url TEXT,
    last_read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_chapter_cache_url ON chapter_cache(url);
  `,
];

export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!);
    db.pragma(`user_version = ${v + 1}`);
  }
}
```

- [ ] **Step 4: Write `src/db/index.ts`**

```typescript
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export type Db = Database.Database;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations.ts src/db/index.ts src/db/index.test.ts
git commit -m "feat: add SQLite open and migration runner"
```

---

### Task 5: Fake LLM client (test helper)

**Files:**
- Create: `test/helpers/fakeLlm.ts`
- Test: `test/helpers/fakeLlm.test.ts`

- [ ] **Step 1: Write the failing test `test/helpers/fakeLlm.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/helpers/fakeLlm.test.ts`
Expected: FAIL — cannot find `./fakeLlm.js`.

- [ ] **Step 3: Write `test/helpers/fakeLlm.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/helpers/fakeLlm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/fakeLlm.ts test/helpers/fakeLlm.test.ts
git commit -m "test: add FakeLlmClient helper"
```

---

### Task 6: Real Anthropic LLM client (streaming + prompt caching)

**Files:**
- Create: `src/llm/anthropic.ts`
- Test: `src/llm/anthropic.test.ts`

The real client accepts an injected SDK-like object so it is testable without network.

- [ ] **Step 1: Write the failing test `src/llm/anthropic.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/anthropic.test.ts`
Expected: FAIL — cannot find `./anthropic.js`.

- [ ] **Step 3: Write `src/llm/anthropic.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/anthropic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/anthropic.ts src/llm/anthropic.test.ts
git commit -m "feat: add Anthropic LLM client with streaming and prompt caching"
```

---

### Task 7: Fixture HTTP server (test helper)

**Files:**
- Create: `test/helpers/fixtureServer.ts`
- Test: `test/helpers/fixtureServer.test.ts`

- [ ] **Step 1: Write the failing test `test/helpers/fixtureServer.test.ts`**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { startFixtureServer } from "./fixtureServer.js";

const server = await startFixtureServer({
  "/chapter-1": { body: "<html><body><h1>One</h1></body></html>" },
  "/redir": { status: 302, headers: { location: "/chapter-1" } },
});
afterAll(() => server.close());

describe("startFixtureServer", () => {
  it("serves a fixture route and exposes a base url", async () => {
    const res = await fetch(`${server.url}/chapter-1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>One</h1>");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${server.url}/missing`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/helpers/fixtureServer.test.ts`
Expected: FAIL — cannot find `./fixtureServer.js`.

- [ ] **Step 3: Write `test/helpers/fixtureServer.ts`**

```typescript
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface FixtureRoute {
  body?: string;
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
}

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

export function startFixtureServer(
  routes: Record<string, FixtureRoute>,
): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const route = routes[path];
    if (!route) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.statusCode = route.status ?? 200;
    res.setHeader("content-type", route.contentType ?? "text/html; charset=utf-8");
    for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v);
    res.end(route.body ?? "");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/helpers/fixtureServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/fixtureServer.ts test/helpers/fixtureServer.test.ts
git commit -m "test: add local fixture HTTP server helper"
```

---

### Task 8: Entry stub + full verification

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`** (placeholder entry so `build`/`dev` resolve; Wave 2 replaces it)

```typescript
// Composition root. Wave 2 (server) wires the pipeline here.
export {};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("stet: foundation ready. Server wiring lands in Wave 2.");
}
```

- [ ] **Step 2: Run the full suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests PASS (types, cacheKey, db, fakeLlm, anthropic, fixtureServer); build emits `dist/` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "chore: add entry stub and verify foundation builds green"
```

---

## Self-Review (run before declaring foundation done)

1. **Contract coverage:** every interface in the roadmap's `src/types.ts` block is
   present and exported. `LlmClient` has both `streamEdit` and `selectLink`.
2. **Placeholder scan:** none — every step has real code/commands.
3. **Type consistency:** `computeCacheKey` signature matches the roadmap; DB columns
   map 1:1 to `ChapterCacheEntry`/`RawChapter`/`Story` fields the Store wave will use.
4. **Dependencies installed:** all roadmap deps present in `package.json` so Wave 1
   worktrees never edit it.

## Handoff to Wave 1

Once this merges to `main`, dispatch Wave 1 subsystems (A Fetcher, B Extractor,
C Editor, D Config, E Store) into separate worktrees in parallel. Each imports from
`src/types.ts`, `src/db`, `src/llm`, `src/util`, and `test/helpers` read-only.
