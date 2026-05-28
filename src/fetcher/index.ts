import { chromium, type Browser } from "playwright";
import type { Fetcher, FetchResult, SiteAdapter } from "../types.js";
import { httpFetch } from "./httpFetch.js";
import { shouldEscalate } from "./escalation.js";
import { browserFetch } from "./browserFetch.js";
import { log, withSpan } from "../obs/index.js";

export function createFetcher(opts: { stateDir: string }): Fetcher {
  let browser: Browser | undefined;

  async function getBrowser(): Promise<Browser> {
    if (!browser) {
      log.info("launching headless browser");
      browser = await chromium.launch();
    }
    return browser;
  }

  return {
    async fetch(url: string, adapter?: SiteAdapter): Promise<FetchResult> {
      return withSpan(
        "fetch",
        async (span) => {
          const http = await httpFetch(url);
          log.debug("http fetch", { url, status: http.status, bytes: http.html.length });
          const escalate = shouldEscalate({ status: http.status, html: http.html }, adapter);
          span.setAttribute("fetch.escalated", escalate);
          if (!escalate) {
            return { html: http.html, finalUrl: http.finalUrl, status: http.status, usedBrowser: false };
          }
          log.info("escalating to browser", { url, httpStatus: http.status, bytes: http.html.length });
          const b = await getBrowser();
          const res = await browserFetch(b, url, adapter, opts.stateDir);
          log.debug("browser fetch done", { url, status: res.status, bytes: res.html.length });
          return { html: res.html, finalUrl: res.finalUrl, status: res.status, usedBrowser: true };
        },
        { url },
      );
    },
    async close(): Promise<void> {
      if (browser) log.info("closing headless browser");
      await browser?.close();
      browser = undefined;
    },
  };
}
