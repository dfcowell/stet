import { chromium, type Browser } from "playwright";
import type { Fetcher, FetchResult, SiteAdapter } from "../types.js";
import { httpFetch } from "./httpFetch.js";
import { shouldEscalate, isSuccessStatus } from "./escalation.js";
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
          // A site adapter can force the browser path; skip the HTTP probe.
          if (adapter?.fetchMode === "browser") {
            span.setAttribute("fetch.escalated", true);
            log.info("escalating to browser", { url, reason: "adapter" });
            const b = await getBrowser();
            const res = await browserFetch(b, url, adapter, opts.stateDir);
            log.debug("browser fetch done", { url, status: res.status, bytes: res.html.length });
            return { html: res.html, finalUrl: res.finalUrl, status: res.status, usedBrowser: true };
          }

          const http = await httpFetch(url);
          log.debug("http fetch", { url, status: http.status, bytes: http.html.length });

          // Never escalate on a non-2xx response — return it for the caller to
          // bail on. Browser escalation is only for successful pages that need
          // JS rendering or gate clearing.
          const escalate =
            isSuccessStatus(http.status) && shouldEscalate({ status: http.status, html: http.html }, adapter);
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
