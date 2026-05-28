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
