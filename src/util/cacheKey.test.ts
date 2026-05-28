import { describe, it, expect } from "vitest";
import { sha256 } from "./hash.js";
import { computeCacheKey } from "./cacheKey.js";

describe("sha256", () => {
  it("is deterministic and hex", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });
});

describe("computeCacheKey", () => {
  const base = { url: "https://x/1", profileId: "p", promptHash: "h", model: "m" };
  it("is stable for same inputs", () => {
    expect(computeCacheKey(base)).toBe(computeCacheKey({ ...base }));
  });
  it("changes when any field changes", () => {
    expect(computeCacheKey(base)).not.toBe(computeCacheKey({ ...base, model: "m2" }));
    expect(computeCacheKey(base)).not.toBe(computeCacheKey({ ...base, promptHash: "h2" }));
  });
});
