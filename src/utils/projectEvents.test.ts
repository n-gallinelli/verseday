import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  emitProjectChanged,
  onProjectChanged,
  PROJECT_CHANGED_EVENT,
} from "./projectEvents";

// Locks the broadcast bus contract: emit → subscribed handler fires;
// unsubscribe → silent; node-safe without a window. `window` is stubbed with a
// plain EventTarget (Node 24 provides EventTarget + CustomEvent globals).

describe("projectEvents bus", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a subscribed handler fires on emit", () => {
    let fired = 0;
    const off = onProjectChanged(() => {
      fired++;
    });
    emitProjectChanged();
    expect(fired).toBe(1);
    off();
  });

  it("unsubscribe is balanced — handler no longer fires", () => {
    let fired = 0;
    const off = onProjectChanged(() => {
      fired++;
    });
    off();
    emitProjectChanged();
    expect(fired).toBe(0);
  });

  it("exposes a stable event name", () => {
    expect(PROJECT_CHANGED_EVENT).toBe("verseday:project-changed");
  });

  it("is a no-op without a window (query-layer node safety)", () => {
    vi.unstubAllGlobals(); // window undefined again
    expect(() => emitProjectChanged()).not.toThrow();
    const off = onProjectChanged(() => {});
    expect(() => off()).not.toThrow();
  });
});
