import type { ReadEvent } from "./index.js";

/** A live subscription to an in-flight producer. */
export interface InflightHandle {
  /**
   * Replays every event buffered so far, then tails live events until the
   * terminal `done`/`error`. Independent subscriptions can be created freely.
   */
  subscribe(): AsyncIterable<ReadEvent>;
}

export interface InflightRegistry {
  /**
   * Ensure exactly one producer runs for `key`. The first caller starts
   * `producer()` as a detached background task; later callers attach to it.
   * The producer runs to completion regardless of whether anyone subscribes.
   */
  getOrStart(key: string, producer: () => AsyncIterable<ReadEvent>): InflightHandle;
}

interface Entry {
  events: ReadEvent[];
  done: boolean;
  subscribers: Set<(ev: ReadEvent) => void>;
}

function isTerminal(ev: ReadEvent): boolean {
  return ev.type === "done" || ev.type === "error";
}

export function createInflightRegistry(): InflightRegistry {
  const entries = new Map<string, Entry>();

  function emit(key: string, entry: Entry, ev: ReadEvent): void {
    entry.events.push(ev);
    if (isTerminal(ev)) {
      entry.done = true;
      entries.delete(key); // post-terminal reads hit the cache or start fresh
    }
    for (const cb of entry.subscribers) cb(ev);
  }

  async function drive(
    key: string,
    entry: Entry,
    producer: () => AsyncIterable<ReadEvent>,
  ): Promise<void> {
    try {
      for await (const ev of producer()) emit(key, entry, ev);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!entry.done) emit(key, entry, { type: "error", message });
    }
    // Defend against a producer that ends without a terminal event: subscribers
    // must never hang waiting for one.
    if (!entry.done) {
      emit(key, entry, { type: "error", message: "producer ended without a terminal event" });
    }
  }

  function subscribe(entry: Entry): AsyncIterable<ReadEvent> {
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ReadEvent> {
        // Snapshot the buffer and register the live callback synchronously, with
        // no await in between, so emit() cannot interleave: no event is missed
        // or duplicated.
        const queue: ReadEvent[] = [...entry.events];
        let wake: (() => void) | null = null;
        const cb = (ev: ReadEvent) => {
          queue.push(ev);
          if (wake) {
            const w = wake;
            wake = null;
            w();
          }
        };
        const live = !entry.done;
        if (live) entry.subscribers.add(cb);
        try {
          for (;;) {
            while (queue.length > 0) {
              const ev = queue.shift()!;
              yield ev;
              if (isTerminal(ev)) return;
            }
            if (!live) return; // already-done entry: buffer fully drained
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        } finally {
          if (live) entry.subscribers.delete(cb);
        }
      },
    };
  }

  function getOrStart(key: string, producer: () => AsyncIterable<ReadEvent>): InflightHandle {
    let entry = entries.get(key);
    if (!entry) {
      entry = { events: [], done: false, subscribers: new Set() };
      entries.set(key, entry);
      void drive(key, entry, producer);
    }
    const e = entry;
    return { subscribe: () => subscribe(e) };
  }

  return { getOrStart };
}
