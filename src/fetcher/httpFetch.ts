export interface HttpResult {
  html: string;
  finalUrl: string;
  status: number;
}

export async function httpFetch(url: string, timeoutMs = 15000): Promise<HttpResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; stet/0.1; +https://localhost) AppleWebKit/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();
    return { html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(t);
  }
}
