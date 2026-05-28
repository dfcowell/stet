import { openDb } from "./db/index.js";
import { createChapterCache } from "./store/chapterCache.js";
import { createLibraryStore } from "./store/libraryStore.js";
import { createProfileStore } from "./config/profiles.js";
import { createAdapterStore } from "./config/adapters.js";
import { createFetcher } from "./fetcher/index.js";
import { createExtractor } from "./extractor/index.js";
import { createEditor } from "./editor/index.js";
import { AnthropicClient } from "./llm/anthropic.js";
import { createPipeline } from "./pipeline/index.js";
import { createApp } from "./server/app.js";
import { startServer } from "./server/serve.js";
import { buildStory } from "./library/builder.js";
import { DEFAULT_MODEL } from "./config-defaults.js";

const env = (k: string, d: string) => process.env[k] ?? d;
const configDir = env("STET_CONFIG_DIR", "./config");

const db = openDb(env("STET_DB_PATH", "./data/stet.sqlite"));
const cache = createChapterCache(db);
const library = createLibraryStore(db);
const profiles = createProfileStore({ dir: `${configDir}/profiles` });
const adapters = createAdapterStore({ dir: `${configDir}/adapters` });
const fetcher = createFetcher({ stateDir: env("STET_STATE_DIR", "./data/state") });
const llm = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
const extractor = createExtractor({ llm, model: DEFAULT_MODEL });
const editor = createEditor({ llm });
const pipeline = createPipeline({ fetcher, extractor, editor, cache, profiles, adapters });

const app = createApp({
  pipeline, profiles, library, webDir: env("STET_WEB_DIR", "./web"),
  buildStory: (url) => buildStory(url, { fetcher, extractor, adapters }),
});

const port = Number(env("PORT", "8787"));
startServer(app, { port, webDir: env("STET_WEB_DIR", "./web") });
console.log(`stet listening on http://localhost:${port}`);
