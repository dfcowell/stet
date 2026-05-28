import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStorageState, saveStorageState } from "./storageState.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "stet-ss-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("storageState", () => {
  it("returns undefined when none saved", () => {
    expect(loadStorageState(dir, "example.com")).toBeUndefined();
  });
  it("round-trips per-domain state", () => {
    const state = { cookies: [{ name: "a", value: "1" }], origins: [] };
    saveStorageState(dir, "example.com", state);
    expect(loadStorageState(dir, "example.com")).toEqual(state);
    // different domain is isolated
    expect(loadStorageState(dir, "other.com")).toBeUndefined();
  });
});
