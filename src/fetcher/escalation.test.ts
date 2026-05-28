import { describe, it, expect } from "vitest";
import { shouldEscalate, isSuccessStatus, GATE_MARKERS } from "./escalation.js";

describe("isSuccessStatus", () => {
  it("is true only for 2xx", () => {
    expect(isSuccessStatus(200)).toBe(true);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(302)).toBe(false);
    expect(isSuccessStatus(403)).toBe(false);
    expect(isSuccessStatus(525)).toBe(false);
  });
});

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
  it("does not escalate based on status (non-2xx is bailed by the fetcher, not escalated)", () => {
    expect(shouldEscalate({ status: 403, html: "x".repeat(5000) }, undefined)).toBe(false);
    expect(shouldEscalate({ status: 525, html: "x".repeat(5000) }, undefined)).toBe(false);
  });
  it("does NOT escalate for a healthy content-rich 200", () => {
    const html = `<html><body>${"<p>real prose here</p>".repeat(80)}</body></html>`;
    expect(shouldEscalate({ status: 200, html }, undefined)).toBe(false);
  });
});
