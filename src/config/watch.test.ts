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
