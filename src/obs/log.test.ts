import { describe, it, expect } from "vitest";
import { createLogger, parseLogLevel } from "./log.js";

describe("createLogger", () => {
  it("suppresses levels below the threshold", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "info", sink: (l) => lines.push(l) });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const out = lines.join("\n");
    expect(out).not.toContain("DEBUG");
    expect(out).toContain("INFO");
    expect(out).toContain("WARN");
    expect(out).toContain("ERROR");
    expect(lines).toHaveLength(3);
  });

  it("formats fields as key=value and quotes values with spaces", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "debug", sink: (l) => lines.push(l) });
    log.debug("fetch", { url: "http://x/1", status: 200, note: "a b" });
    expect(lines[0]).toContain("fetch");
    expect(lines[0]).toContain("url=http://x/1");
    expect(lines[0]).toContain("status=200");
    expect(lines[0]).toContain('note="a b"');
  });

  it("defaults to info level", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    log.debug("hidden");
    log.info("shown");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("shown");
  });
});

describe("parseLogLevel", () => {
  it("accepts valid levels case-insensitively and falls back to info", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("WARN")).toBe("warn");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("nonsense")).toBe("info");
  });
});
