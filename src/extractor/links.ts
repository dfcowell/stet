import type { ChapterLink } from "../types.js";

export function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function collectLinks(doc: Document, base: string): ChapterLink[] {
  const out: ChapterLink[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const raw = a.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#")) continue;
    const url = absolute(raw, base);
    if (!url) continue;
    const noHash = url.split("#")[0]!;
    if (noHash === base.split("#")[0]) continue; // self
    if (seen.has(noHash)) continue;
    seen.add(noHash);
    out.push({ title: (a.textContent ?? "").trim().slice(0, 200), url: noHash, index: i++ });
  }
  return out;
}

export function relHints(doc: Document, base: string): { next: string | null; prev: string | null } {
  const pick = (rel: string): string | null => {
    const link = doc.querySelector(`link[rel~="${rel}"]`) ?? doc.querySelector(`a[rel~="${rel}"]`);
    const href = link?.getAttribute("href");
    return href ? absolute(href, base) : null;
  };
  return { next: pick("next"), prev: pick("prev") };
}

export function registrableDomain(host: string): string {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

export function sameRegistrableDomain(a: string, b: string): boolean {
  try {
    return registrableDomain(new URL(a).hostname) === registrableDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}
