import type { SiteAdapter } from "../types.js";

// Substrings that strongly indicate an interstitial gate/consent wall.
export const GATE_MARKERS = [
  "Are you 18 or older",
  "I am over 18",
  "Verify your age",
  "content warning",
  "Checking your browser before",
  "Enable JavaScript and cookies to continue",
  "cf-browser-verification",
];

const MIN_USABLE_BYTES = 1024;

export function shouldEscalate(
  http: { status: number; html: string },
  adapter: SiteAdapter | undefined,
): boolean {
  if (adapter?.fetchMode === "browser") return true;
  if (adapter?.fetchMode === "http") return false;
  if (http.status === 403 || http.status === 429 || http.status >= 500) return true;
  if (http.html.length < MIN_USABLE_BYTES) return true;
  const lower = http.html.toLowerCase();
  if (GATE_MARKERS.some((m) => lower.includes(m.toLowerCase()))) return true;
  return false;
}
