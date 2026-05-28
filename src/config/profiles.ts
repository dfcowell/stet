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
