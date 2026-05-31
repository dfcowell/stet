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
import { registerSerial } from "./library/register.js";
import { DEFAULT_MODEL } from "./config-defaults.js";
import { log, initObservability } from "./obs/index.js";
import { parseOidcConfig } from "./auth/config.js";
import { createOidcClient } from "./auth/oidc.js";
import { createAuth, type Auth } from "./auth/index.js";

const env = (k: string, d: string) => process.env[k] ?? d;
const configDir = env("STET_CONFIG_DIR", "./config");

await initObservability();

const db = openDb(env("STET_DB_PATH", "./data/stet.sqlite"));
const cache = createChapterCache(db);
const library = createLibraryStore(db);
const profiles = createProfileStore({ dir: `${configDir}/profiles` });
const adapters = createAdapterStore({ dir: `${configDir}/adapters` });
const browserDisabled = /^(1|true|yes)$/i.test(process.env.STET_DISABLE_BROWSER ?? "");
if (browserDisabled) log.info("browser automation disabled (STET_DISABLE_BROWSER)");
const fetcher = createFetcher({ stateDir: env("STET_STATE_DIR", "./data/state"), browserDisabled });
const llm = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
const extractor = createExtractor({ llm, model: DEFAULT_MODEL });
const editor = createEditor({ llm });
const pipeline = createPipeline({ fetcher, extractor, editor, cache, profiles, adapters });

let auth: Auth | undefined;
const oidcConfig = parseOidcConfig(process.env);
if (oidcConfig) {
  const oidcClient = await createOidcClient(oidcConfig);
  auth = createAuth(oidcConfig, oidcClient);
  log.info("oidc gate enabled", { issuer: oidcConfig.issuer, group: oidcConfig.groupId });
} else {
  log.info("oidc gate disabled (no STET_OIDC_* configured)");
}

const app = createApp({
  pipeline, profiles, library, cache, webDir: env("STET_WEB_DIR", "./web"),
  addSerial: (url) => registerSerial(url, { fetcher, extractor, adapters }),
  auth,
});

const port = Number(env("PORT", "8787"));
startServer(app, { port, webDir: env("STET_WEB_DIR", "./web") });
log.info("stet listening", { url: `http://localhost:${port}` });
