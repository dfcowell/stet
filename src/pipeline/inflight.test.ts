import { describe, it, expect } from "vitest";
import { createInflightRegistry } from "./inflight.js";
import type { ReadEvent } from "./index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function collect(it: AsyncIterable<ReadEvent>): Promise<ReadEvent[]> {
  const out: ReadEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const meta = (): ReadEvent => ({ type: "meta", title: "T", nextUrl: null, prevUrl: null, cached: false });

describe("createInflightRegistry", () => {
  it("runs the producer once and fans events out to concurrent subscribers", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const producer = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield meta();
      yield { type: "delta", text: "AB" };
      yield { type: "done", full: "AB" };
    };
    const h1 = reg.getOrStart("k", producer);
    const h2 = reg.getOrStart("k", producer);
    const [a, b] = await Promise.all([collect(h1.subscribe()), collect(h2.subscribe())]);
    expect(runs).toBe(1);
    expect(a).toEqual(b);
    expect(a.at(-1)).toEqual({ type: "done", full: "AB" });
  });

  it("replays buffered events to a late subscriber, then tails live events", async () => {
    const reg = createInflightRegistry();
    const reached = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta();
      yield { type: "delta", text: "early" };
      reached.resolve();
      await gate.promise;
      yield { type: "delta", text: "late" };
      yield { type: "done", full: "earlylate" };
    };
    const first = collect(reg.getOrStart("k", producer).subscribe());
    await reached.promise; // "early" is now buffered
    const second = collect(reg.getOrStart("k", producer).subscribe()); // late join
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    const texts = (evs: ReadEvent[]) => evs.filter((e) => e.type === "delta").map((e: any) => e.text);
    expect(texts(b)).toEqual(["early", "late"]);
    expect(b.find((e) => e.type === "meta")).toBeTruthy();
    expect(a).toEqual(b);
  });

  it("runs the producer to completion even if every subscriber detaches early", async () => {
    const reg = createInflightRegistry();
    const completed = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta();
      await gate.promise;
      yield { type: "done", full: "X" };
      completed.resolve();
    };
    const h = reg.getOrStart("k", producer);
    for await (const _ev of h.subscribe()) break; // take first event, then abandon
    gate.resolve();
    await completed.promise; // resolves only if the producer ran past the gate
    expect(true).toBe(true);
  });

  it("delivers a terminal error to subscribers and lets the next getOrStart restart", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const failing = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield { type: "error", message: "boom" };
    };
    const a = await collect(reg.getOrStart("k", failing).subscribe());
    expect(a.at(-1)).toEqual({ type: "error", message: "boom" });
    const b = await collect(reg.getOrStart("k", failing).subscribe());
    expect(b.at(-1)).toEqual({ type: "error", message: "boom" });
    expect(runs).toBe(2); // entry was removed after the error, so it restarts
  });

  it("starts the producer without a subscriber and lets a later subscriber attach", async () => {
    const reg = createInflightRegistry();
    let runs = 0;
    const reached = deferred();
    const gate = deferred();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      runs++;
      yield meta();
      reached.resolve();
      await gate.promise;
      yield { type: "done", full: "Y" };
    };
    reg.getOrStart("k", producer); // no subscribe — just start it (prefetch case)
    await reached.promise;
    const sub = collect(reg.getOrStart("k", producer).subscribe());
    gate.resolve();
    const evs = await sub;
    expect(runs).toBe(1);
    expect(evs.find((e) => e.type === "meta")).toBeTruthy();
    expect(evs.at(-1)).toEqual({ type: "done", full: "Y" });
  });

  it("emits an error terminal if the producer ends without one (no hanging subscribers)", async () => {
    const reg = createInflightRegistry();
    const producer = async function* (): AsyncIterable<ReadEvent> {
      yield meta(); // no done/error
    };
    const evs = await collect(reg.getOrStart("k", producer).subscribe());
    expect(evs.at(-1)?.type).toBe("error");
  });
});
