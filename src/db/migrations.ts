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
