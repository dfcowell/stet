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
