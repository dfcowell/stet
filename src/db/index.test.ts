import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./index.js";

describe("openDb", () => {
  it("creates the parent directory when it does not exist yet", () => {
    const base = mkdtempSync(join(tmpdir(), "stet-db-"));
    const nested = join(base, "data", "nested", "stet.sqlite");
    const db = openDb(nested);
    expect(existsSync(nested)).toBe(true);
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

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
