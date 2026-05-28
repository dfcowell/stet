import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function fileFor(dir: string, domain: string): string {
  const safe = domain.replace(/[^a-z0-9.-]/gi, "_");
  return join(dir, `${safe}.json`);
}

export function loadStorageState(dir: string, domain: string): unknown | undefined {
  const f = fileFor(dir, domain);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, "utf8"));
}

export function saveStorageState(dir: string, domain: string, state: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(dir, domain), JSON.stringify(state), "utf8");
}
