import { chromium, type Browser } from "playwright";
import type { Fetcher, FetchResult, SiteAdapter } from "../types.js";
import { httpFetch } from "./httpFetch.js";
import { shouldEscalate } from "./escalation.js";
import { browserFetch } from "./browserFetch.js";

export function createFetcher(opts: { stateDir: string }): Fetcher {
  let browser: Browser | undefined;

  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }

  return {
    async fetch(url: string, adapter?: SiteAdapter): Promise<FetchResult> {
      const http = await httpFetch(url);
      if (!shouldEscalate({ status: http.status, html: http.html }, adapter)) {
        return { html: http.html, finalUrl: http.finalUrl, status: http.status, usedBrowser: false };
      }
      const b = await getBrowser();
      const res = await browserFetch(b, url, adapter, opts.stateDir);
      return { html: res.html, finalUrl: res.finalUrl, status: res.status, usedBrowser: true };
    },
    async close(): Promise<void> {
      await browser?.close();
      browser = undefined;
    },
  };
}
