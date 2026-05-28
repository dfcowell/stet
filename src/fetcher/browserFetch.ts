import type { Browser } from "playwright";
import type { SiteAdapter } from "../types.js";
import { loadStorageState, saveStorageState } from "./storageState.js";

export interface BrowserResult {
  html: string;
  finalUrl: string;
  status: number;
}

export async function browserFetch(
  browser: Browser,
  url: string,
  adapter: SiteAdapter | undefined,
  stateDir: string,
): Promise<BrowserResult> {
  const domain = adapter?.domain ?? new URL(url).hostname;
  const storageState = loadStorageState(stateDir, domain) as any;
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    for (const step of adapter?.gateSteps ?? []) {
      if (step.action === "click") {
        await page.click(step.selector, { timeout: 10000 }).catch(() => {});
      } else if (step.action === "waitForSelector") {
        await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? 10000 }).catch(() => {});
      } else if (step.action === "wait") {
        await page.waitForTimeout(step.ms);
      }
    }
    const html = await page.content();
    saveStorageState(stateDir, domain, await context.storageState());
    return { html, finalUrl: page.url(), status: resp?.status() ?? 200 };
  } finally {
    await context.close();
  }
}
