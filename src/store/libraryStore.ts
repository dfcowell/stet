import type { Db } from "../db/index.js";
import type { LibraryStore, Story, ChapterLink } from "../types.js";

interface StoryRow {
  id: string; title: string; source_domain: string; index_url: string | null;
  chapters_json: string; current_chapter_url: string | null; last_read_at: number | null;
}

function rowToStory(r: StoryRow): Story {
  return {
    id: r.id, title: r.title, sourceDomain: r.source_domain, indexUrl: r.index_url,
    chapters: JSON.parse(r.chapters_json) as ChapterLink[],
    progress: { currentChapterUrl: r.current_chapter_url, lastReadAt: r.last_read_at },
  };
}

export function createLibraryStore(db: Db): LibraryStore {
  const listStmt = db.prepare("SELECT * FROM story ORDER BY title");
  const getStmt = db.prepare<[string]>("SELECT * FROM story WHERE id = ?");
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO story
      (id, title, source_domain, index_url, chapters_json, current_chapter_url, last_read_at)
    VALUES (@id, @title, @sourceDomain, @indexUrl, @chaptersJson, @currentChapterUrl, @lastReadAt)
  `);
  const progressStmt = db.prepare<[string, number, string]>(
    "UPDATE story SET current_chapter_url = ?, last_read_at = ? WHERE id = ?",
  );

  return {
    listStories: () => (listStmt.all() as StoryRow[]).map(rowToStory),
    getStory(id) {
      const r = getStmt.get(id) as StoryRow | undefined;
      return r ? rowToStory(r) : undefined;
    },
    upsertStory(s) {
      upsertStmt.run({
        id: s.id, title: s.title, sourceDomain: s.sourceDomain, indexUrl: s.indexUrl,
        chaptersJson: JSON.stringify(s.chapters),
        currentChapterUrl: s.progress.currentChapterUrl, lastReadAt: s.progress.lastReadAt,
      });
    },
    setProgress(storyId, currentChapterUrl, lastReadAt) {
      progressStmt.run(currentChapterUrl, lastReadAt, storyId);
    },
  };
}
