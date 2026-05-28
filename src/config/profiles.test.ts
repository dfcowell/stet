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
