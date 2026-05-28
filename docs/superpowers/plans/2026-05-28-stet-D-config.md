# stet Config (Profiles + Site Adapters) Implementation Plan (Wave 1 — D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This subsystem lives entirely under `src/config`. Import contracts read-only from `src/types.ts`, helpers from `src/util/hash.js` and `src/config-defaults.js`. Do NOT edit `package.json` or other subsystems' files.

**Goal:** Implement `ProfileStore` and `AdapterStore` — load editing profiles and optional per-site adapters from watched config folders, hot-reload on change, derive `promptHash`, and resolve the active profile / adapter-for-domain.

**Architecture:** Profiles are Markdown files (optional `--- key: value ---` frontmatter for `name/model/maxTokens/temperature`; the body is the system prompt). Adapters are JSON files matching `SiteAdapter`. Each store loads synchronously on creation and exposes `reload()`; a `chokidar` watcher calls `reload()` + fires `onChange` subscribers. Defaults come from `src/config-defaults.ts`.

**Tech Stack:** `chokidar`, Node `fs`.

**Contracts used (from `src/types.ts`):** `Profile`, `ProfileStore`, `SiteAdapter`, `AdapterStore`.

---

### Task 1: Profile file parser (pure)

**Files:**
- Create: `src/config/profileFile.ts`
- Test: `src/config/profileFile.test.ts`

- [ ] **Step 1: Write failing test `src/config/profileFile.test.ts`**

```typescript
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
```

- [ ] **Step 2:** Run `npx vitest run src/config/profileFile.test.ts` → FAIL.

- [ ] **Step 3: Write `src/config/profileFile.ts`**

```typescript
import { basename } from "node:path";
import type { Profile } from "../types.js";
import { sha256 } from "../util/hash.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "../config-defaults.js";

export function parseProfileFile(filename: string, content: string): Profile {
  const id = basename(filename).replace(/\.(md|markdown|txt)$/i, "");
  const meta: Record<string, string> = {};
  let body = content;

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    for (const line of fm[1]!.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
      if (m) meta[m[1]!.toLowerCase()] = m[2]!.trim();
    }
    body = fm[2]!;
  }

  const systemPrompt = body.trim();
  const name = meta.name || id;
  const model = meta.model || DEFAULT_MODEL;
  const maxTokens = meta.maxtokens ? Number(meta.maxtokens) : DEFAULT_MAX_TOKENS;
  const temperature = meta.temperature !== undefined ? Number(meta.temperature) : DEFAULT_TEMPERATURE;
  const promptHash = sha256(`${systemPrompt}\n${model}\n${maxTokens}\n${temperature}`);

  return { id, name, systemPrompt, model, maxTokens, temperature, promptHash };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/profileFile.ts src/config/profileFile.test.ts
git commit -m "feat(config): add profile file parser"
```

---

### Task 2: ProfileStore (load, active selection, reload, watch)

**Files:**
- Create: `src/config/profiles.ts`
- Test: `src/config/profiles.test.ts`

- [ ] **Step 1: Write failing test `src/config/profiles.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileStore } from "./profiles.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stet-prof-"));
  writeFileSync(join(dir, "alpha.md"), "---\nname: Alpha\n---\nedit A");
  writeFileSync(join(dir, "beta.md"), "edit B");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("createProfileStore", () => {
  it("loads all profiles and exposes get/list", () => {
    const store = createProfileStore({ dir, watch: false });
    expect(store.list().map((p) => p.id).sort()).toEqual(["alpha", "beta"]);
    expect(store.get("alpha")?.name).toBe("Alpha");
    store.close();
  });

  it("defaults active to the first profile by id and allows switching", () => {
    const store = createProfileStore({ dir, watch: false });
    expect(store.getActive().id).toBe("alpha");
    store.setActive("beta");
    expect(store.getActive().id).toBe("beta");
    store.close();
  });

  it("reload() picks up a newly added profile and fires onChange", () => {
    const store = createProfileStore({ dir, watch: false });
    let fired = 0;
    store.onChange(() => { fired++; });
    writeFileSync(join(dir, "gamma.md"), "edit G");
    store.reload();
    expect(store.get("gamma")).toBeDefined();
    expect(fired).toBe(1);
    store.close();
  });
});
```

> The plan adds a `reload()` method beyond the `ProfileStore` interface for deterministic testing; it is an additive public method, the interface methods remain exactly as in `src/types.ts`.

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/config/profiles.ts`**

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Profile, ProfileStore } from "../types.js";
import { parseProfileFile } from "./profileFile.js";

export interface ProfileStoreWithReload extends ProfileStore {
  reload(): void;
}

export function createProfileStore(opts: { dir: string; watch?: boolean }): ProfileStoreWithReload {
  let profiles = new Map<string, Profile>();
  let activeId: string | undefined;
  const subs = new Set<() => void>();
  let watcher: FSWatcher | undefined;

  function load(): void {
    const next = new Map<string, Profile>();
    let files: string[] = [];
    try {
      files = readdirSync(opts.dir).filter((f) => /\.(md|markdown|txt)$/i.test(f));
    } catch {
      files = [];
    }
    for (const f of files.sort()) {
      const p = parseProfileFile(f, readFileSync(join(opts.dir, f), "utf8"));
      next.set(p.id, p);
    }
    profiles = next;
    if (activeId && !profiles.has(activeId)) activeId = undefined;
  }

  function fire(): void { for (const cb of subs) cb(); }

  load();

  if (opts.watch !== false) {
    watcher = chokidar.watch(opts.dir, { ignoreInitial: true });
    watcher.on("all", () => { load(); fire(); });
  }

  return {
    list: () => [...profiles.values()],
    get: (id) => profiles.get(id),
    getActive() {
      const id = activeId ?? [...profiles.keys()].sort()[0];
      const p = id ? profiles.get(id) : undefined;
      if (!p) throw new Error("no profiles loaded");
      return p;
    },
    setActive(id) {
      if (!profiles.has(id)) throw new Error(`unknown profile: ${id}`);
      activeId = id;
    },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    reload() { load(); fire(); },
    close() { void watcher?.close(); subs.clear(); },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/profiles.ts src/config/profiles.test.ts
git commit -m "feat(config): add ProfileStore with active selection and hot-reload"
```

---

### Task 3: AdapterStore (load JSON, forDomain longest-suffix match)

**Files:**
- Create: `src/config/adapters.ts`
- Test: `src/config/adapters.test.ts`

- [ ] **Step 1: Write failing test `src/config/adapters.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapterStore } from "./adapters.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stet-adp-"));
  writeFileSync(join(dir, "site.json"), JSON.stringify({ domain: "site.example", fetchMode: "browser" }));
  writeFileSync(join(dir, "sub.json"), JSON.stringify({ domain: "reader.site.example", selectors: { body: ".c" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("createAdapterStore", () => {
  it("matches the longest domain suffix", () => {
    const store = createAdapterStore({ dir, watch: false });
    expect(store.forDomain("reader.site.example")?.selectors?.body).toBe(".c");
    expect(store.forDomain("www.site.example")?.fetchMode).toBe("browser");
    expect(store.forDomain("unrelated.test")).toBeUndefined();
    store.close();
  });

  it("ignores malformed adapter files", () => {
    writeFileSync(join(dir, "bad.json"), "{ not json");
    const store = createAdapterStore({ dir, watch: false });
    store.reload();
    expect(store.forDomain("site.example")).toBeDefined();
    store.close();
  });
});
```

- [ ] **Step 2:** Run test → FAIL.

- [ ] **Step 3: Write `src/config/adapters.ts`**

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { SiteAdapter, AdapterStore } from "../types.js";

export interface AdapterStoreWithReload extends AdapterStore {
  reload(): void;
}

function matches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function createAdapterStore(opts: { dir: string; watch?: boolean }): AdapterStoreWithReload {
  let adapters: SiteAdapter[] = [];
  const subs = new Set<() => void>();
  let watcher: FSWatcher | undefined;

  function load(): void {
    const next: SiteAdapter[] = [];
    let files: string[] = [];
    try {
      files = readdirSync(opts.dir).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(opts.dir, f), "utf8"));
        if (data && typeof data.domain === "string") next.push(data as SiteAdapter);
      } catch {
        // ignore malformed adapter file
      }
    }
    adapters = next;
  }

  function fire(): void { for (const cb of subs) cb(); }

  load();

  if (opts.watch !== false) {
    watcher = chokidar.watch(opts.dir, { ignoreInitial: true });
    watcher.on("all", () => { load(); fire(); });
  }

  return {
    forDomain(hostname) {
      const candidates = adapters.filter((a) => matches(hostname, a.domain));
      candidates.sort((a, b) => b.domain.length - a.domain.length);
      return candidates[0];
    },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    reload() { load(); fire(); },
    close() { void watcher?.close(); subs.clear(); },
  };
}
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/adapters.ts src/config/adapters.test.ts
git commit -m "feat(config): add AdapterStore with longest-suffix domain match"
```

---

### Task 4: Barrel export + live-watch smoke test

**Files:**
- Create: `src/config/index.ts`
- Test: `src/config/watch.test.ts`

- [ ] **Step 1: Write `src/config/index.ts`**

```typescript
export { createProfileStore } from "./profiles.js";
export { createAdapterStore } from "./adapters.js";
export { parseProfileFile } from "./profileFile.js";
```

- [ ] **Step 2: Write tolerant watch test `src/config/watch.test.ts`**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileStore } from "./profiles.js";

let close: (() => void) | undefined;
afterEach(() => close?.());

describe("ProfileStore live watch", () => {
  it("fires onChange when a file is added", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stet-watch-"));
    writeFileSync(join(dir, "a.md"), "edit A");
    const store = createProfileStore({ dir, watch: true });
    close = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };

    const changed = new Promise<void>((resolve) => store.onChange(() => resolve()));
    // give chokidar a beat to attach, then add a file
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(dir, "b.md"), "edit B");

    await Promise.race([
      changed,
      new Promise((_, rej) => setTimeout(() => rej(new Error("no change event")), 8000)),
    ]);
    expect(store.get("b")).toBeDefined();
  });
});
```

- [ ] **Step 3:** Run `npx vitest run src/config && npm run typecheck`
Expected: all config tests PASS; typecheck clean. (If the live-watch test is flaky in your environment, re-run once; chokidar is real-fs based.)

- [ ] **Step 4: Commit**

```bash
git add src/config/index.ts src/config/watch.test.ts
git commit -m "feat(config): add barrel export and live-watch smoke test"
```

---

## Self-Review
1. **Spec coverage:** profiles from a watched folder ✔; user-supplied system prompt ✔; optional model/params ✔; hot-reload ✔; active profile selection + switch ✔; optional site adapters hot-reloaded ✔; `promptHash` derived for cache keying ✔.
2. **Placeholder scan:** none.
3. **Type consistency:** stores implement `ProfileStore`/`AdapterStore` from `src/types.ts` (plus an additive `reload()`); `Profile` fields exactly match; `onChange` returns an unsubscribe fn as declared.
4. **No package.json edits**; only `src/config/**`.
