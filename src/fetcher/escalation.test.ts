import { describe, it, expect } from "vitest";
import { shouldEscalate, GATE_MARKERS } from "./escalation.js";

describe("shouldEscalate", () => {
  it("escalates when adapter forces browser mode", () => {
    expect(shouldEscalate({ status: 200, html: "x".repeat(5000) }, { domain: "d", fetchMode: "browser" })).toBe(true);
  });
  it("escalates on too-thin body", () => {
    expect(shouldEscalate({ status: 200, html: "<html></html>" }, undefined)).toBe(true);
  });
  it("escalates when a gate marker is present", () => {
    const html = `<html><body>${GATE_MARKERS[0]}</body></html>`;
    expect(shouldEscalate({ status: 200, html }, undefined)).toBe(true);
  });
  it("escalates on 403", () => {
    expect(shouldEscalate({ status: 403, html: "x".repeat(5000) }, undefined)).toBe(true);
  });
  it("does NOT escalate for a healthy content-rich 200", () => {
    const html = `<html><body>${"<p>real prose here</p>".repeat(80)}</body></html>`;
    expect(shouldEscalate({ status: 200, html }, undefined)).toBe(false);
  });
});
