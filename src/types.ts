// ----- Domain -----

export interface ChapterLink {
  title: string;
  url: string;        // absolute URL
  index: number;      // position within a detected chapter-index list
}

export interface ExtractedChapter {
  sourceUrl: string;
  title: string;
  serialTitle: string | null; // serial-level title if extractable from this page
  rawText: string;            // cleaned prose, paragraphs separated by "\n\n"
  html: string | null;        // Readability article HTML, if available
  nextUrl: string | null;
  prevUrl: string | null;
  indexUrl: string | null;    // chapter-index/TOC page if detected
  chapterLinks: ChapterLink[]; // populated when sourceUrl IS an index page
  navConfidence: "high" | "low"; // heuristic confidence; "low" → LLM fallback used
}

export interface Profile {
  id: string;                 // derived from config filename (sans extension)
  name: string;
  systemPrompt: string;
  model: string;              // resolved (falls back to DEFAULT_MODEL)
  maxTokens: number;          // resolved (falls back to DEFAULT_MAX_TOKENS)
  temperature: number;        // resolved (falls back to DEFAULT_TEMPERATURE)
  promptHash: string;         // sha256 over systemPrompt+model+maxTokens+temperature
}

export type GateStep =
  | { action: "click"; selector: string }
  | { action: "waitForSelector"; selector: string; timeoutMs?: number }
  | { action: "wait"; ms: number };

export interface SiteAdapter {
  domain: string;             // matched as suffix of the request hostname
  fetchMode?: "http" | "browser";
  selectors?: {
    body?: string;
    next?: string;
    prev?: string;
    index?: string;
    serialTitle?: string;   // serial-level title element
    chapterTitle?: string;  // override for chapter title (defaults to og:title / content heading)
    chapterList?: string;   // container whose <a> descendants are chapters
  };
  gateSteps?: GateStep[];
}

// ----- Persistence rows -----

export interface ChapterCacheEntry {
  key: string;                // computeCacheKey(...)
  url: string;
  profileId: string;
  promptHash: string;
  model: string;
  editedContent: string;
  extractedTitle: string;
  nextUrl: string | null;
  prevUrl: string | null;
  rawExtractedText: string;
  fetchedAt: number;          // epoch ms
}

export interface RawChapter {        // raw extraction, profile-independent
  url: string;
  extractedTitle: string;
  serialTitle: string | null;
  rawExtractedText: string;
  nextUrl: string | null;
  prevUrl: string | null;
  indexUrl: string | null;
  chapterLinks: ChapterLink[];       // page-derived chapter list; [] when none discovered
  fetchedAt: number;
}

export interface Story {
  id: string;
  title: string;
  sourceDomain: string;
  indexUrl: string | null;
  chapters: ChapterLink[];
  progress: { currentChapterUrl: string | null; lastReadAt: number | null };
}

// ----- Infra -----

export interface FetchResult {
  html: string;
  finalUrl: string;
  status: number;
  usedBrowser: boolean;
}

export type EditEvent =
  | { type: "delta"; text: string }
  | { type: "done"; full: string }
  | { type: "error"; message: string };

// Minimal LLM surface both Editor and Extractor depend on (fakeable in tests).
export interface LlmClient {
  // Streaming edit pass. Implementation sets cache_control on `system`.
  streamEdit(args: {
    system: string;
    userText: string;
    model: string;
    maxTokens: number;
    temperature: number;
  }): AsyncIterable<string>;

  // Constrained selection: returns the index into `links`, or null if none fit.
  // The model may ONLY choose among provided links; it cannot emit a URL.
  selectLink(args: {
    instruction: string;
    pageTitle: string;
    links: ChapterLink[];
    model: string;
  }): Promise<number | null>;
}

// ----- Component interfaces (Wave 1 implements these) -----

export interface Fetcher {
  fetch(url: string, adapter?: SiteAdapter): Promise<FetchResult>;
  close(): Promise<void>;     // tears down browser if started
}

export interface Extractor {
  extract(args: {
    html: string;
    sourceUrl: string;
    adapter?: SiteAdapter;
  }): Promise<ExtractedChapter>;
}

export interface Editor {
  edit(rawText: string, profile: Profile): AsyncIterable<EditEvent>;
}

export interface ProfileStore {
  list(): Profile[];
  get(id: string): Profile | undefined;
  getActive(): Profile;
  setActive(id: string): void;
  onChange(cb: () => void): () => void; // returns unsubscribe
  close(): void;                         // stop watching
}

export interface AdapterStore {
  forDomain(hostname: string): SiteAdapter | undefined;
  onChange(cb: () => void): () => void;
  close(): void;
}

export interface ChapterCache {
  get(key: string): ChapterCacheEntry | undefined;
  put(entry: ChapterCacheEntry): void;
  getRawByUrl(url: string): RawChapter | undefined;  // for re-edit without re-fetch
  putRaw(raw: RawChapter): void;
}

export interface LibraryStore {
  listStories(): Story[];
  getStory(id: string): Story | undefined;
  upsertStory(story: Story): void;
  setProgress(storyId: string, currentChapterUrl: string, lastReadAt: number): void;
}
